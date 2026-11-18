use super::security::{JsToken, TokenKind};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeclPhase {
    Target {
        destructure_depth: usize,
        skip_default_depth: Option<usize>,
    },
    Init {
        expr_depth: usize,
    },
}

#[derive(Debug, Clone)]
struct Binding {
    depth: usize,
    paren_depth: usize,
    name: String,
    fn_expr_stop: bool,
}

#[derive(Debug)]
struct ActiveDecl {
    base_depth: usize,
    phase: DeclPhase,
}

/// Tracks JS lexical bindings and safe member/property syntax so benign geometry
/// variables (`const top`, `box.top`, `{ top: 4 }`, `(top) => ...`) are allowed
/// while bare global accesses (`window.location`, unbound `top`) remain blocked.
pub(super) struct JsScopeTracker {
    brace_depth: usize,
    paren_depth: usize,
    fn_depths: Vec<usize>,
    bindings: Vec<Binding>,
    pending_fn_params: Vec<String>,
    decl: Option<ActiveDecl>,
}

impl JsScopeTracker {
    pub(super) fn new() -> Self {
        Self {
            brace_depth: 0,
            paren_depth: 0,
            fn_depths: vec![0],
            bindings: Vec::new(),
            pending_fn_params: Vec::new(),
            decl: None,
        }
    }

    pub(super) fn is_bound(&self, name: &str) -> bool {
        self.bindings.iter().any(|b| b.name == name)
            || self.pending_fn_params.iter().any(|p| p == name)
    }

    pub(super) fn is_safe_context_ident(&self, tokens: &[JsToken], idx: usize) -> bool {
        if is_dot_property(tokens, idx)
            || is_object_key(tokens, idx)
            || is_single_arrow_param(tokens, idx)
        {
            return true;
        }
        self.is_bound(tokens[idx].value.as_str())
    }

    pub(super) fn advance(&mut self, tokens: &[JsToken], idx: usize) {
        let tok = &tokens[idx];
        let prev_is_dot = is_dot_property(tokens, idx);

        if tok.kind == TokenKind::Punct {
            self.handle_punct(tokens, idx);
            return;
        }
        if tok.kind != TokenKind::Ident {
            return;
        }

        let val = tok.value.as_str();
        if !prev_is_dot && matches!(val, "const" | "let" | "var") {
            let base_depth = if val == "var" {
                *self.fn_depths.last().unwrap_or(&0)
            } else {
                self.brace_depth
            };
            self.decl = Some(ActiveDecl {
                base_depth,
                phase: DeclPhase::Target {
                    destructure_depth: 0,
                    skip_default_depth: None,
                },
            });
            return;
        }

        if !prev_is_dot && is_single_arrow_param(tokens, idx) {
            self.pending_fn_params.push(val.to_string());
            return;
        }

        if !prev_is_dot && val == "function" {
            if let Some(next) = tokens.get(idx + 1) {
                if next.kind == TokenKind::Ident {
                    self.bind(self.brace_depth, &next.value, false);
                }
            }
            return;
        }

        if let Some(active) = self.decl.as_mut() {
            if !prev_is_dot
                && matches!(val, "in" | "of")
                && matches!(active.phase, DeclPhase::Target { destructure_depth: 0, .. })
            {
                active.phase = DeclPhase::Init { expr_depth: 0 };
                return;
            }
            if let DeclPhase::Target { skip_default_depth, .. } = active.phase {
                if skip_default_depth.is_none() && !is_object_key(tokens, idx) {
                    let target_depth = active.base_depth;
                    self.bind(target_depth, val, false);
                }
            }
        }
    }

    fn handle_punct(&mut self, tokens: &[JsToken], idx: usize) {
        let p = tokens[idx].value.as_str();
        match p {
            "{" => {
                self.brace_depth += 1;
                let params = std::mem::take(&mut self.pending_fn_params);
                if !params.is_empty() {
                    self.fn_depths.push(self.brace_depth);
                    for name in params {
                        self.bind(self.brace_depth, &name, false);
                    }
                }
            }
            "}" => {
                let closing_depth = self.brace_depth;
                self.brace_depth = self.brace_depth.saturating_sub(1);
                self.bindings.retain(|b| b.depth <= self.brace_depth);
                if self.fn_depths.last().copied() == Some(closing_depth) && closing_depth > 0 {
                    self.fn_depths.pop();
                }
            }
            "(" => {
                self.paren_depth += 1;
                if let Some(params) = extract_fn_param_names(tokens, idx) {
                    self.pending_fn_params.extend(params);
                }
            }
            "[" => self.paren_depth += 1,
            ")" | "]" => self.paren_depth = self.paren_depth.saturating_sub(1),
            "=" if is_arrow_at(tokens, idx)
                && tokens.get(idx + 2).map(|t| t.value.as_str()) != Some("{") =>
            {
                let params = std::mem::take(&mut self.pending_fn_params);
                for name in params {
                    self.bind(self.brace_depth, &name, true);
                }
            }
            _ => {}
        }

        self.advance_decl_punct(p);

        if matches!(p, ";" | "," | ")" | "]" | "}") {
            let b_depth = self.brace_depth;
            let p_depth = self.paren_depth;
            self.bindings.retain(|b| {
                if !b.fn_expr_stop {
                    return true;
                }
                !(b_depth < b.depth
                    || (b_depth == b.depth
                        && ((matches!(p, ")" | "]") && p_depth < b.paren_depth)
                            || (matches!(p, ";" | "," | "}") && p_depth <= b.paren_depth))))
            });
        }
    }

    fn advance_decl_punct(&mut self, p: &str) {
        let Some(active) = self.decl.as_mut() else {
            return;
        };
        match &mut active.phase {
            DeclPhase::Target {
                destructure_depth,
                skip_default_depth,
            } => match p {
                "{" | "[" => *destructure_depth += 1,
                "}" | "]" => {
                    if let Some(sd) = *skip_default_depth {
                        if *destructure_depth <= sd {
                            *skip_default_depth = None;
                        }
                    }
                    *destructure_depth = destructure_depth.saturating_sub(1);
                }
                "=" if *destructure_depth == 0 => {
                    active.phase = DeclPhase::Init { expr_depth: 0 };
                }
                "=" if skip_default_depth.is_none() => {
                    *skip_default_depth = Some(*destructure_depth);
                }
                "," if *destructure_depth > 0 && *skip_default_depth == Some(*destructure_depth) => {
                    *skip_default_depth = None;
                }
                ";" | ")" if *destructure_depth == 0 => self.decl = None,
                _ => {}
            },
            DeclPhase::Init { expr_depth } => match p {
                "(" | "[" | "{" => *expr_depth += 1,
                ")" | "]" | "}" => {
                    if *expr_depth == 0 {
                        self.decl = None;
                    } else {
                        *expr_depth -= 1;
                    }
                }
                "," if *expr_depth == 0 => {
                    active.phase = DeclPhase::Target {
                        destructure_depth: 0,
                        skip_default_depth: None,
                    };
                }
                ";" if *expr_depth == 0 => self.decl = None,
                _ => {}
            },
        }
    }

    fn bind(&mut self, depth: usize, name: &str, fn_expr_stop: bool) {
        self.bindings.push(Binding {
            depth,
            paren_depth: self.paren_depth,
            name: name.to_string(),
            fn_expr_stop,
        });
    }
}

pub(super) fn is_dot_property(tokens: &[JsToken], idx: usize) -> bool {
    idx > 0
        && tokens[idx - 1].kind == TokenKind::Punct
        && tokens[idx - 1].value == "."
}

fn is_arrow_at(tokens: &[JsToken], idx: usize) -> bool {
    tokens
        .get(idx)
        .map(|t| t.kind == TokenKind::Punct && t.value == "=")
        .unwrap_or(false)
        && tokens
            .get(idx + 1)
            .map(|t| t.kind == TokenKind::Punct && t.value == ">")
            .unwrap_or(false)
}

pub(super) fn is_object_key(tokens: &[JsToken], idx: usize) -> bool {
    let prev_ok = idx > 0
        && tokens[idx - 1].kind == TokenKind::Punct
        && matches!(tokens[idx - 1].value.as_str(), "{" | ",");
    let next_colon = tokens
        .get(idx + 1)
        .map(|t| t.kind == TokenKind::Punct && t.value == ":")
        .unwrap_or(false);
    prev_ok && next_colon
}

fn is_single_arrow_param(tokens: &[JsToken], idx: usize) -> bool {
    is_arrow_at(tokens, idx + 1)
}

fn extract_fn_param_names(tokens: &[JsToken], open_idx: usize) -> Option<Vec<String>> {
    let mut depth = 0usize;
    let mut close_idx = None;
    let scan_end = (open_idx + 128).min(tokens.len());
    for (i, t) in tokens.iter().enumerate().take(scan_end).skip(open_idx) {
        if t.kind == TokenKind::Punct {
            if t.value == "(" {
                depth += 1;
            } else if t.value == ")" {
                depth -= 1;
                if depth == 0 {
                    close_idx = Some(i);
                    break;
                }
            }
        }
    }
    let close_idx = close_idx?;
    let is_arrow = is_arrow_at(tokens, close_idx + 1);
    let is_decl_fn = (open_idx > 0 && tokens[open_idx - 1].value == "function")
        || (open_idx > 1
            && tokens[open_idx - 2].value == "function"
            && tokens[open_idx - 1].kind == TokenKind::Ident);
    let is_catch = open_idx > 0
        && tokens[open_idx - 1].kind == TokenKind::Ident
        && tokens[open_idx - 1].value == "catch";
    let is_method_shorthand = tokens
        .get(close_idx + 1)
        .map(|t| t.kind == TokenKind::Punct && t.value == "{")
        .unwrap_or(false)
        && open_idx > 0
        && tokens[open_idx - 1].kind == TokenKind::Ident
        && !matches!(
            tokens[open_idx - 1].value.as_str(),
            "if" | "for" | "while" | "switch" | "with"
        );

    if !(is_arrow || is_decl_fn || is_catch || is_method_shorthand) {
        return None;
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut p_depth = 0usize;
    let mut in_default = false;
    for i in (open_idx + 1)..close_idx {
        let t = &tokens[i];
        if t.kind == TokenKind::Punct {
            match t.value.as_str() {
                "{" | "[" | "(" => p_depth += 1,
                "}" | "]" | ")" => {
                    p_depth = p_depth.saturating_sub(1);
                    if p_depth == 0 {
                        in_default = false;
                    }
                }
                "=" if p_depth == 0 => in_default = true,
                "," if p_depth == 0 => in_default = false,
                _ => {}
            }
            continue;
        }
        if !in_default
            && t.kind == TokenKind::Ident
            && !is_object_key(tokens, i)
            && seen.insert(t.value.clone())
        {
            out.push(t.value.clone());
        }
    }
    Some(out)
}

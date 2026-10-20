//! A queue's auto rename: rules applied in order to a new download's name,
//! leaving its extension alone.

use regex::Regex;

use crate::types::{Pattern, RenameRule};
use crate::worker::split_extension;

/// What an empty name becomes.
const UNTITLED: &str = "untitled";

/// `name` with `rules` applied, in order, to the part before its extension,
/// trimmed. A rule with an invalid regex is skipped; a name the rules leave
/// empty becomes `untitled`.
pub fn apply_rules(name: &str, rules: &[RenameRule]) -> String {
    let (stem, ext) = split_extension(name);
    let mut out = stem.to_string();
    for rule in rules {
        out = match rule {
            RenameRule::Prefix { text } => format!("{text}{out}"),
            RenameRule::Suffix { text } => format!("{out}{text}"),
            RenameRule::Remove { pattern } => replace(&out, pattern, ""),
            RenameRule::Replace { pattern, with } => replace(&out, pattern, with),
        };
    }
    let out = out.trim();
    format!("{}{ext}", if out.is_empty() { UNTITLED } else { out })
}

/// For each rule, what's wrong with its regex, if it has an invalid one;
/// such a rule is skipped.
pub fn rule_errors(rules: &[RenameRule]) -> Vec<Option<String>> {
    rules
        .iter()
        .map(|rule| match rule {
            RenameRule::Remove { pattern } | RenameRule::Replace { pattern, .. } if pattern.regex => {
                compile(&pattern.text).err()
            }
            _ => None,
        })
        .collect()
}

fn replace(text: &str, pattern: &Pattern, with: &str) -> String {
    if pattern.text.is_empty() {
        return text.to_string();
    }
    if !pattern.regex {
        return text.replace(&pattern.text, with);
    }
    match compile(&pattern.text) {
        Ok(regex) => regex.replace_all(text, with).into_owned(),
        Err(_) => text.to_string(),
    }
}

/// Compiles `pattern`, with only the last line of a syntax error, which says
/// what's wrong; the lines before it point at where, for a monospace console.
fn compile(pattern: &str) -> Result<Regex, String> {
    Regex::new(pattern).map_err(|e| {
        let msg = e.to_string();
        let last = msg.lines().last().unwrap_or(&msg);
        last.trim_start_matches("error: ").to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exact(text: &str) -> Pattern {
        Pattern { text: text.into(), regex: false }
    }

    fn regex(text: &str) -> Pattern {
        Pattern { text: text.into(), regex: true }
    }

    #[test]
    fn adds_text_around_the_name_but_not_the_extension() {
        let rules = [
            RenameRule::Prefix { text: "new-".into() },
            RenameRule::Suffix { text: "-v2".into() },
        ];
        assert_eq!(apply_rules("report.pdf", &rules), "new-report-v2.pdf");
        assert_eq!(apply_rules("a.tar.gz", &rules), "new-a.tar-v2.gz");
        assert_eq!(apply_rules(".bashrc", &rules), "new-.bashrc-v2");
        assert_eq!(apply_rules("noext", &rules), "new-noext-v2");
    }

    #[test]
    fn removes_and_replaces_exact_text() {
        let rules = [
            RenameRule::Remove { pattern: exact("[www.site.com] ") },
            RenameRule::Replace { pattern: exact("_"), with: " ".into() },
        ];
        assert_eq!(apply_rules("[www.site.com] my_file_x.mkv", &rules), "my file x.mkv");
    }

    #[test]
    fn exact_text_is_not_a_regex() {
        let rules = [RenameRule::Remove { pattern: exact(".") }];
        assert_eq!(apply_rules("a.b.c.zip", &rules), "abc.zip");
    }

    #[test]
    fn regex_replaces_every_match_with_captures() {
        let rules = [
            RenameRule::Replace { pattern: regex(r"(\d+)x(\d+)"), with: "$2 by $1".into() },
            RenameRule::Remove { pattern: regex(r"\s+$") },
        ];
        assert_eq!(apply_rules("pic 640x480 .png", &rules), "pic 480 by 640.png");
    }

    #[test]
    fn rules_apply_in_order() {
        let rules = [
            RenameRule::Prefix { text: "a".into() },
            RenameRule::Replace { pattern: exact("a"), with: "b".into() },
        ];
        assert_eq!(apply_rules("a.txt", &rules), "bb.txt");
    }

    #[test]
    fn names_the_rules_empty_untitled() {
        let rules = [RenameRule::Remove { pattern: regex(".*") }];
        assert_eq!(apply_rules("file.zip", &rules), "untitled.zip");
        let rules = [RenameRule::Replace { pattern: exact("file"), with: "  ".into() }];
        assert_eq!(apply_rules("file.zip", &rules), "untitled.zip");
    }

    #[test]
    fn trims_the_name() {
        let rules = [RenameRule::Remove { pattern: exact("[x]") }];
        assert_eq!(apply_rules("[x] file .zip", &rules), "file.zip");
    }

    #[test]
    fn empty_patterns_do_nothing() {
        let rules = [RenameRule::Replace { pattern: regex(""), with: "x".into() }];
        assert_eq!(apply_rules("file.zip", &rules), "file.zip");
    }

    #[test]
    fn rules_with_an_invalid_regex_are_skipped() {
        let rules = [
            RenameRule::Remove { pattern: regex("(") },
            RenameRule::Prefix { text: "a ".into() },
            RenameRule::Remove { pattern: exact("(") },
        ];
        assert_eq!(apply_rules("(file).zip", &rules), "a file).zip");
        let errors = rule_errors(&rules);
        assert!(errors[0].as_deref().is_some_and(|e| e.contains("unclosed group")), "{errors:?}");
        assert_eq!(errors[1..], [None, None]);
    }
}

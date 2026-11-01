//! Whether a queue's schedule lets it run at a given time of day.

use std::time::Duration;

use chrono::{Local, Timelike};

use crate::types::{Schedule, ScheduleMode, TimeWindow};

/// Minutes in a day.
pub(crate) const DAY: u16 = 24 * 60;

impl TimeWindow {
    /// Whether `minute` (since local midnight) falls inside the window.
    pub fn contains(&self, minute: u16) -> bool {
        if self.start < self.end {
            self.start <= minute && minute < self.end
        } else if self.end < self.start {
            minute >= self.start || minute < self.end
        } else {
            false
        }
    }
}

impl Schedule {
    /// Whether the queue may run at `minute` (since local midnight).
    pub fn allows(&self, minute: u16) -> bool {
        match self.mode {
            ScheduleMode::Any => true,
            ScheduleMode::Hours => self.windows.iter().any(|window| window.contains(minute)),
        }
    }

    /// Whether a window starts after `from` and by `to` (minutes since local
    /// midnight, going forward and wrapping past midnight).
    pub fn starts_between(&self, from: u16, to: u16) -> bool {
        self.mode == ScheduleMode::Hours
            && self
                .windows
                .iter()
                .any(|window| window.start != window.end && passed(window.start, from, to))
    }

    /// Whether a window ends after `from` and by `to`, as [`Schedule::starts_between`].
    pub fn ends_between(&self, from: u16, to: u16) -> bool {
        self.mode == ScheduleMode::Hours
            && self
                .windows
                .iter()
                .any(|window| window.start != window.end && passed(window.end, from, to))
    }

    /// The schedule with every time kept within a day.
    pub(crate) fn sanitized(self) -> Self {
        let clamp = |minute: u16| minute.min(DAY - 1);
        Self {
            windows: self
                .windows
                .into_iter()
                .map(|window| TimeWindow {
                    start: clamp(window.start),
                    end: clamp(window.end),
                })
                .collect(),
            ..self
        }
    }
}

/// Whether `minute` comes after `from` and by `to`, going forward from `from`
/// and wrapping past midnight. Nothing passes when `from` and `to` are equal.
fn passed(minute: u16, from: u16, to: u16) -> bool {
    let ahead = |m: u16| (m + DAY - from) % DAY;
    let gone = ahead(minute);
    gone > 0 && gone <= ahead(to)
}

/// Minutes since midnight, in the local time zone as it is now.
pub(crate) fn local_minute() -> u16 {
    let now = Local::now();
    (now.hour() * 60 + now.minute()) as u16
}

/// How long until the next minute starts. Read again after each wait, so a
/// changed clock or time zone shows within a minute.
pub(crate) fn until_next_minute() -> Duration {
    let second = Local::now().second().min(59);
    Duration::from_secs(u64::from(60 - second))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(start: u16, end: u16) -> TimeWindow {
        TimeWindow { start, end }
    }

    fn hours(windows: Vec<TimeWindow>) -> Schedule {
        Schedule {
            mode: ScheduleMode::Hours,
            windows,
        }
    }

    #[test]
    fn a_window_includes_its_start_and_not_its_end() {
        let w = window(60, 405);
        assert!(!w.contains(59));
        assert!(w.contains(60));
        assert!(w.contains(404));
        assert!(!w.contains(405));
    }

    #[test]
    fn a_window_can_run_past_midnight() {
        let w = window(1320, 90);
        assert!(w.contains(1320));
        assert!(w.contains(1439));
        assert!(w.contains(0));
        assert!(w.contains(89));
        assert!(!w.contains(90));
        assert!(!w.contains(600));
    }

    #[test]
    fn an_empty_window_never_runs() {
        assert!(!window(300, 300).contains(300));
        assert!(!hours(vec![window(300, 300)]).allows(300));
    }

    #[test]
    fn any_time_always_runs() {
        let schedule = Schedule {
            mode: ScheduleMode::Any,
            windows: vec![window(60, 120)],
        };
        assert!(schedule.allows(0));
        assert!(schedule.allows(1000));
    }

    #[test]
    fn hours_run_inside_any_window() {
        let schedule = hours(vec![window(60, 120), window(100, 200)]);
        assert!(schedule.allows(60));
        assert!(schedule.allows(150));
        assert!(!schedule.allows(200));
        assert!(!hours(Vec::new()).allows(0));
    }

    #[test]
    fn a_start_counts_once_the_time_reaches_it() {
        let schedule = hours(vec![window(250, 300)]);
        assert!(schedule.starts_between(249, 250));
        assert!(schedule.starts_between(100, 260), "after a long gap");
        assert!(!schedule.starts_between(250, 251), "already past");
        assert!(!schedule.starts_between(250, 250));
        assert!(schedule.starts_between(1430, 255), "across midnight");
        assert!(schedule.ends_between(299, 300));
        assert!(!schedule.ends_between(300, 301));
    }

    #[test]
    fn any_time_has_no_starts_or_ends() {
        let schedule = Schedule {
            mode: ScheduleMode::Any,
            windows: vec![window(250, 300)],
        };
        assert!(!schedule.starts_between(0, 1000));
        assert!(!schedule.ends_between(0, 1000));
    }

    #[test]
    fn sanitizing_keeps_times_within_a_day() {
        let schedule = hours(vec![window(5000, 2000)]).sanitized();
        assert_eq!(schedule.windows, vec![window(1439, 1439)]);
    }

    #[test]
    fn old_saves_without_a_schedule_run_any_time() {
        let settings: crate::QueueSettings =
            serde_json::from_str(r#"{"max_concurrent":2,"paused":false,"retries":3,"rename":[]}"#).unwrap();
        assert_eq!(settings.schedule, Schedule::default());
        assert!(settings.schedule.allows(0));
    }
}

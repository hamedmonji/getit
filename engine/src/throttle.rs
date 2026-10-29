//! A limit on how fast all downloads together receive data. Each download's
//! loop reports the bytes it got and waits as long as the limit asks; while it
//! waits it doesn't read, so the connection slows to match.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Shared by every download; cloning is cheap and clones share the limit.
#[derive(Clone, Default)]
pub(crate) struct Throttle(Arc<Mutex<Pacer>>);

impl Throttle {
    /// Sets the limit in bytes per second, or lifts it with None.
    pub(crate) fn set_limit(&self, limit: Option<u64>) {
        let mut pacer = self.0.lock().unwrap_or_else(|e| e.into_inner());
        *pacer = Pacer { limit: limit.filter(|l| *l > 0), next: None };
    }

    /// Counts `bytes` just received, then waits until the limit allows them.
    pub(crate) async fn wait(&self, bytes: u64) {
        let until = self.0.lock().unwrap_or_else(|e| e.into_inner()).reserve(Instant::now(), bytes);
        if let Some(until) = until {
            tokio::time::sleep_until(until.into()).await;
        }
    }
}

#[derive(Default)]
struct Pacer {
    limit: Option<u64>,
    /// When the bytes counted so far will have been received at the limit.
    next: Option<Instant>,
}

impl Pacer {
    /// Counts `bytes` received at `now`, and returns when they're allowed: once
    /// everything counted before them, then they, have taken their time at the
    /// limit. None without a limit. Time spent idle isn't saved up for a burst.
    fn reserve(&mut self, now: Instant, bytes: u64) -> Option<Instant> {
        let limit = self.limit?;
        let start = self.next.map_or(now, |next| next.max(now));
        let next = start + Duration::from_secs_f64(bytes as f64 / limit as f64);
        self.next = Some(next);
        Some(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pacer(limit: u64) -> Pacer {
        Pacer { limit: Some(limit), next: None }
    }

    #[test]
    fn allows_anything_without_a_limit() {
        assert_eq!(Pacer::default().reserve(Instant::now(), 1 << 30), None);
    }

    #[test]
    fn spaces_bytes_out_at_the_limit() {
        let now = Instant::now();
        let mut p = pacer(1000);
        assert_eq!(p.reserve(now, 500), Some(now + Duration::from_millis(500)));
        // Bytes arriving together, as from several downloads, queue behind each other.
        assert_eq!(p.reserve(now, 1000), Some(now + Duration::from_millis(1500)));
    }

    #[test]
    fn saves_no_burst_from_idle_time() {
        let now = Instant::now();
        let mut p = pacer(1000);
        p.reserve(now, 100);
        let later = now + Duration::from_secs(10);
        assert_eq!(p.reserve(later, 100), Some(later + Duration::from_millis(100)));
    }

    #[test]
    fn treats_a_zero_limit_as_none() {
        let throttle = Throttle::default();
        throttle.set_limit(Some(0));
        assert!(throttle.0.lock().unwrap().limit.is_none());
    }
}

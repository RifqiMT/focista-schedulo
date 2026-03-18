import { useEffect, useState } from "react";

interface Stats {
  completedToday: number;
  streakDays: number;
  level: number;
  xpToNext: number;
  pointsToday: number;
  totalPoints: number;
}

export function GamificationPanel() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadStats() {
      try {
        const res = await fetch("/api/stats", { signal: controller.signal });
        if (!res.ok) return;
        const data: Stats = await res.json();
        setStats(data);
      } catch {
        // ignore
      }
    }
    loadStats();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handler = () => {
      const run = async () => {
        try {
          const res = await fetch("/api/stats");
          if (!res.ok) return;
          const data: Stats = await res.json();
          setStats(data);
        } catch {
          // ignore
        }
      };
      void run();
    };
    window.addEventListener("pst:tasks-changed", handler);
    return () => window.removeEventListener("pst:tasks-changed", handler);
  }, []);

  const completedToday = stats?.completedToday ?? 0;
  const streakDays = stats?.streakDays ?? 0;
  const level = stats?.level ?? 1;
  const xpToNext = stats?.xpToNext ?? 50;
  const pointsToday = stats?.pointsToday ?? 0;
  const totalPoints = stats?.totalPoints ?? 0;

  const pointsIntoLevel = totalPoints % 50;
  const xpBarPercent = Math.min(100, (pointsIntoLevel / 50) * 100);

  return (
    <section className="gamification-panel">
      <h2>Progress</h2>
      <div className="gamification-card">
        <div className="stat-row">
          <div>
            <div className="stat-label">Tasks completed today</div>
            <div className="stat-value">{completedToday}</div>
          </div>
          <div>
            <div className="stat-label">Focus streak</div>
            <div className="stat-value">{streakDays} days</div>
          </div>
        </div>

        <div className="xp-section">
          <div className="stat-label">Level {level}</div>
          <div className="xp-bar">
            <div
              className="xp-bar-fill"
              style={{ width: `${xpBarPercent}%` }}
            />
          </div>
          <div className="xp-caption">
            {pointsToday} XP today · {xpToNext} XP to next level
          </div>
        </div>

        <ul className="badge-list">
          <li className="badge-item">Early Starter · Complete 3 tasks before 10am</li>
          <li className="badge-item">
            Consistency Builder · Maintain a 7-day completion streak
          </li>
        </ul>
      </div>
    </section>
  );
}


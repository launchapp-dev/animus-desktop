import { useState } from "react";

function App() {
  const [count] = useState(0);

  return (
    <main className="container">
      <header>
        <h1>Animus</h1>
        <p className="subtitle">The app for AI teams</p>
      </header>

      <section className="status">
        <h2>v0.0.1 — scaffold</h2>
        <p>
          This is the v1 build skeleton. Daemon supervisor, plugin manager,
          GitHub OAuth, repo picker, CI/CD team template, project list, and
          cycle drill-down are all in active development.
        </p>
        <p>
          See <code>docs/ROADMAP.md</code> for the v1 scope and slice
          ownership.
        </p>
        <p className="muted">Projects loaded: {count}</p>
      </section>
    </main>
  );
}

export default App;

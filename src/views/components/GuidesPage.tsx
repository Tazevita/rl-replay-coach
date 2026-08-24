interface Guide {
  id: string;
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  topics: readonly string[];
  href: string;
  action: string;
  youtubeId?: string;
}

const guides: readonly Guide[] = [
  {
    id: "replay-review",
    number: "01",
    eyebrow: "Replay review",
    title: "Read the match, not just the scoreboard.",
    description: "Learn the complete replay workflow, from upload to the decisions that changed the game.",
    topics: ["Upload and navigate a replay", "Use 2D, 3D, and Auto Cam", "Read team analysis and projections"],
    href: "/",
    action: "Open replay viewer",
    youtubeId: "wO0YZea9R_Q",
  },
  {
    id: "player-analysis",
    number: "02",
    eyebrow: "Player analysis",
    title: "Turn repeated mistakes into a training plan.",
    description: "See how multiple saved replays become coaching priorities you can take into your next session.",
    topics: ["Find a player across saved replays", "Choose the right replay context", "Interpret habits and coaching priorities"],
    href: "/check-player",
    action: "Open Player Analysis",
    youtubeId: "Bb_fqQll160",
  },
];

export function GuidesPage() {
  return <main className="app-shell guides-page">
    <a className="back-link" href="/">Back to replay viewer</a>
    <header className="guides-hero">
      <p className="eyebrow">Replay Lab guides</p>
      <h1>See the game. <br /><span>Change the next one.</span></h1>
      <p>Two focused walkthroughs for getting useful answers from your replays, without missing the tools built to help you improve.</p>
      <nav className="guides-index" aria-label="Guide chapters">
        {guides.map(guide => <a href={`#${guide.id}`} key={guide.id}><span>{guide.number}</span> {guide.eyebrow}</a>)}
      </nav>
    </header>

    <div className="guide-chapters">
      {guides.map(guide => <section className="guide-chapter" id={guide.id} key={guide.id}>
        <div className="guide-video-shell">
          {guide.youtubeId
            ? <iframe
                src={`https://www.youtube-nocookie.com/embed/${guide.youtubeId}`}
                title={`${guide.eyebrow} video guide`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
                allowFullScreen
              />
            : <div className="guide-video-placeholder">
                <span>{guide.number}</span>
                <div>
                  <strong>Video link pending</strong>
                  <small>16:9 walkthrough</small>
                </div>
              </div>}
        </div>
        <div className="guide-copy">
          <div className="guide-chapter-heading">
            <span>{guide.number}</span>
            <p className="eyebrow">{guide.eyebrow}</p>
          </div>
          <h2>{guide.title}</h2>
          <p>{guide.description}</p>
          <div className="guide-topics">
            <strong>In this guide</strong>
            <ol>{guide.topics.map(topic => <li key={topic}>{topic}</li>)}</ol>
          </div>
          <a className="guide-action" href={guide.href}>{guide.action}<span aria-hidden="true">→</span></a>
        </div>
      </section>)}
    </div>
  </main>;
}

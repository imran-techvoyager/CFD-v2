"use client";

const icons = [
  { title: "Instruments", d: "M4 6h16M4 12h16M4 18h10" },
  { title: "Calendar", d: "M8 2v4M16 2v4M3 8h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" },
  { title: "History", d: "M12 8v4l3 3M21 12a9 9 0 11-9-9 9 9 0 019 9z" },
  { title: "Code", d: "M8 9l-4 3 4 3M16 9l4 3-4 3" },
  { title: "Settings", d: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 21h-4l-.4-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12a7 7 0 01.1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 012-1.2L10 3h4l.4 2.6a7 7 0 012 1.2l2.4-1 2 3.4-2 1.6c.1.4.2.8.2 1.2z" },
];

export function IconRail() {
  return (
    <div className="icon-rail">
      {icons.map((ic, i) => (
        <button key={ic.title} className={`rail-btn ${i === 0 ? "active" : ""}`} title={ic.title}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={ic.d} />
          </svg>
        </button>
      ))}
    </div>
  );
}

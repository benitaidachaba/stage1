"use client";

import { useState, type ReactNode } from "react";

/** A compact task deck inspired by the supplied Hover Stack interaction. */
export default function HoverStack({
  upcoming,
  children,
}: {
  upcoming: Array<{ id: string; title: string }>;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`hoverStack${hovered ? " hoverStack--active" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {[...upcoming.slice(0, 2)].reverse().map((task, index) => (
        <div className={`hoverStackBack hoverStackBack--${index}`} key={task.id} aria-hidden="true">
          <span>{task.title}</span>
        </div>
      ))}
      {children}
    </div>
  );
}

"use client";

import { useState, type CSSProperties } from "react";

export interface HoverStackCard {
  id: string;
  title: string;
  note?: string;
  dueLabel?: string;
  overdue?: boolean;
}

export interface HoverStackProps {
  cards: HoverStackCard[];
  onDone: (id: string) => void;
  onTomorrow: (id: string) => void;
  onSkip: (id: string) => void;
}

const ROTATIONS = [-5, 4, -3];

/** Overlapping cards spread on hover; touch shows a single card with the next two behind it. */
export default function HoverStack({ cards, onDone, onTomorrow, onSkip }: HoverStackProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  function actions(card: HoverStackCard) {
    return <div className="decisionActions">
      <button type="button" className="btn btn--primary" onClick={() => onDone(card.id)}>Done</button>
      <button type="button" className="btn" onClick={() => onTomorrow(card.id)}>Tomorrow</button>
      <button type="button" className="btn btn--quiet" onClick={() => onSkip(card.id)}>Skip</button>
    </div>;
  }

  return <div className="decisionStack">
    <div className="decisionStackDesktop" onMouseLeave={() => setActiveIndex(null)}>
      {cards.map((card, index) => {
        const offset = index * 112 + (activeIndex === null ? 0 : index < activeIndex ? -95 : index > activeIndex ? 95 : 0);
        const active = activeIndex === index;
        const style: CSSProperties = {
          transform: `translate3d(${offset}px, ${active ? -22 : 0}px, 0) rotate(${active ? 0 : ROTATIONS[index % ROTATIONS.length]}deg) scale(${active ? 1.025 : 1})`,
          zIndex: active ? 20 : index + 1,
        };
        return <article className="decisionCard" key={card.id} style={style} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)}>
          <div><span className="decisionCardIndex">{String(index + 1).padStart(2, "0")}</span>{card.overdue ? <span className="overdueBadge">Overdue</span> : null}</div>
          <div className="decisionCardContent"><h3>{card.title}</h3>{card.note ? <p>{card.note}</p> : null}{card.dueLabel ? <span className="hint">{card.dueLabel}</span> : null}</div>
          <div><div className="decisionDivider" />{actions(card)}</div>
        </article>;
      })}
    </div>
    <div className="decisionStackMobile">
      {cards.slice(1, 3).reverse().map((card, index) => <div className={`decisionBack decisionBack--${index}`} key={card.id} aria-hidden="true" />)}
      {cards[0] ? <article className="decisionCard decisionCard--mobile">
        <div><span className="decisionCardIndex">01 / {cards.length}</span>{cards[0].overdue ? <span className="overdueBadge">Overdue</span> : null}</div>
        <div className="decisionCardContent"><h3>{cards[0].title}</h3>{cards[0].note ? <p>{cards[0].note}</p> : null}{cards[0].dueLabel ? <span className="hint">{cards[0].dueLabel}</span> : null}</div>
        <div><div className="decisionDivider" />{actions(cards[0])}</div>
      </article> : null}
    </div>
  </div>;
}

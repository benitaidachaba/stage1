"use client";

/**
 * One icon family for the whole app: Phosphor, outline weight, 18–20px in
 * text, paired with text wherever an action has a name. Decorative icons get
 * aria-hidden; meaningful ones get labels. No emoji, anywhere.
 *
 * Keeping every import in one module means a reader can audit the app's icon
 * language in one sitting — and swap the family in one place if ever needed.
 */

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowRight,
  BookOpen,
  Briefcase,
  CalendarBlank,
  CaretDown,
  Check,
  Circle,
  DotsThree,
  Flag,
  Heart,
  House,
  Leaf,
  ListChecks,
  Microphone,
  Pause,
  Planet,
  Plus,
  Question,
  SignOut,
  GearSix,
  Sparkle,
  Stack,
  User,
  Waveform,
  X,
} from "@phosphor-icons/react";
import type { Icon as IconType } from "@phosphor-icons/react";
import type { AreaIcon } from "@/lib/types";

/** Standard sizes, so icons never drift. */
export const ICON_SIZE = { inline: 18, control: 20, header: 22 } as const;

export const AppIcons = {
  now: Playish,
  today: CalendarBlank,
  triage: Stack,
  log: ListChecks,
  settings: GearSix,
  help: Question,
  search: Planet,
  capture: Plus,
  voice: Microphone,
  listening: Waveform,
  done: Check,
  drop: X,
  later: ArrowClockwise,
  skip: CaretDown,
  undo: ArrowCounterClockwise,
  timer: Pause,
  user: User,
  out: SignOut,
  more: DotsThree,
  start: ArrowRight,
  read: Waveform,
} as const;

/** Area glyphs, mapped to Phosphor so no emoji is ever rendered. */
export const AREA_ICON_COMPONENTS: Record<AreaIcon, IconType> = {
  dot: Circle,
  book: BookOpen,
  briefcase: Briefcase,
  home: House,
  heart: Heart,
  spark: Sparkle,
  leaf: Leaf,
  flag: Flag,
};

function Playish(props: Parameters<IconType>[0]) {
  // Phosphor has no plain "play" in this curated set import list; ArrowRight
  // reads as "go" in a button row and keeps the family consistent.
  return <ArrowRight weight="bold" {...props} />;
}

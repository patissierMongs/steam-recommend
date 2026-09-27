import "server-only";
import { connection } from "next/server";
import type { OwnedGame, PlayerSummary } from "@/lib/types";

export const DEMO_ID = "demo";

const STEAMID64_RE = /^\d{17}$/;

export function isDemoId(id: string): boolean {
  return id === DEMO_ID;
}

export function isProfileParam(id: string): boolean {
  return STEAMID64_RE.test(id) || isDemoId(id);
}

const DEFAULT_AVATAR = "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";

export const DEMO_PROFILE: PlayerSummary = {
  steamid: DEMO_ID,
  personaname: "데모 플레이어",
  profileurl: "",
  avatar: DEFAULT_AVATAR,
  avatarmedium: DEFAULT_AVATAR,
  avatarfull: DEFAULT_AVATAR,
  personastate: 0,
  communityvisibilitystate: 3,
};

interface DemoEntry {
  appid: number;
  name: string;
  hours: number;
  daysAgo: number | null;
}

const DEMO_ENTRIES: DemoEntry[] = [
  { appid: 413150, name: "Stardew Valley", hours: 150, daysAgo: 3 },
  { appid: 646570, name: "Slay the Spire", hours: 90, daysAgo: 12 },
  { appid: 367520, name: "Hollow Knight", hours: 70, daysAgo: 40 },
  { appid: 1145360, name: "Hades", hours: 60, daysAgo: 20 },
  { appid: 105600, name: "Terraria", hours: 50, daysAgo: 90 },
  { appid: 250900, name: "The Binding of Isaac: Rebirth", hours: 45, daysAgo: 150 },
  { appid: 632360, name: "Risk of Rain 2", hours: 40, daysAgo: 60 },
  { appid: 2379780, name: "Balatro", hours: 33, daysAgo: 1 },
  { appid: 588650, name: "Dead Cells", hours: 30, daysAgo: 100 },
  { appid: 1794680, name: "Vampire Survivors", hours: 25, daysAgo: 30 },
  { appid: 504230, name: "Celeste", hours: 15, daysAgo: 120 },
  { appid: 1092790, name: "Inscryption", hours: 12, daysAgo: 80 },
  { appid: 1086940, name: "Baldur's Gate 3", hours: 36, daysAgo: 240 },
  { appid: 292030, name: "The Witcher 3: Wild Hunt", hours: 25, daysAgo: 700 },
  { appid: 435150, name: "Divinity: Original Sin 2", hours: 15, daysAgo: 500 },
  { appid: 814380, name: "Sekiro: Shadows Die Twice", hours: 12, daysAgo: 400 },
  { appid: 620, name: "Portal 2", hours: 10, daysAgo: 900 },
  { appid: 322330, name: "Don't Starve Together", hours: 1, daysAgo: 300 },
  { appid: 257850, name: "Hyper Light Drifter", hours: 0.75, daysAgo: 350 },
  { appid: 1057090, name: "Ori and the Will of the Wisps", hours: 0.5, daysAgo: 200 },
  { appid: 294100, name: "RimWorld", hours: 0.3, daysAgo: 250 },
  { appid: 268910, name: "Cuphead", hours: 0, daysAgo: null },
  { appid: 753640, name: "Outer Wilds", hours: 0, daysAgo: null },
  { appid: 391540, name: "Undertale", hours: 0, daysAgo: null },
  { appid: 1942280, name: "Brotato", hours: 0, daysAgo: null },
  { appid: 2231450, name: "Pizza Tower", hours: 0, daysAgo: null },
  { appid: 457140, name: "Oxygen Not Included", hours: 0, daysAgo: null },
  { appid: 427520, name: "Factorio", hours: 0, daysAgo: null },
  { appid: 1150690, name: "OMORI", hours: 0, daysAgo: null },
  { appid: 1332010, name: "Stray", hours: 0, daysAgo: null },
  { appid: 1868140, name: "DAVE THE DIVER", hours: 0, daysAgo: null },
  { appid: 239140, name: "Dying Light", hours: 0, daysAgo: null },
];

export function buildDemoLibrary(nowMs: number): OwnedGame[] {
  const nowSec = Math.floor(nowMs / 1000);
  return DEMO_ENTRIES.map((e) => ({
    appid: e.appid,
    name: e.name,
    playtime_forever: Math.round(e.hours * 60),
    playtime_2weeks: e.daysAgo !== null && e.daysAgo <= 14 ? Math.min(Math.round(e.hours * 60), 300) : undefined,
    rtime_last_played: e.daysAgo === null ? 0 : nowSec - e.daysAgo * 86400,
  }));
}

export async function getDemoLibrary(): Promise<OwnedGame[]> {
  await connection();
  return buildDemoLibrary(Date.now());
}

/**
 * Build switches, set by electron-vite's `define` (electron.vite.config.ts) from the environment at build time.
 *
 * LIVE_COMBAT (`GRIDWISE_LIVE_COMBAT=1`): live combat cues, off by default. Off, the overlay does not call out what
 * the player is getting hit with right now: no SCRAMMED / POINTED / NEUT / JAMMED rows from the log, and no live
 * "shoot this first" order in the Abyss (the room's options are shown instead). What the NPCs can do ("can SCRAM",
 * from the SDE and the wiki), the trigger hits and the timed copilot messages stay.
 * Tests and the dev CLI see it off unless they pass it in.
 */
declare const __GRIDWISE_LIVE_COMBAT__: boolean | undefined;

export const LIVE_COMBAT: boolean =
  typeof __GRIDWISE_LIVE_COMBAT__ !== 'undefined' && __GRIDWISE_LIVE_COMBAT__ === true;

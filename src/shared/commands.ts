import { z } from 'zod';
import { LIMITS } from './constants';
import type { Role } from './types';

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * A video sent by a client. The thumbnail URL is deliberately not accepted:
 * the server derives it from the video ID so clients cannot inject arbitrary URLs.
 */
export const videoInput = z.object({
  videoId: z.string().regex(VIDEO_ID_RE),
  title: z.string().trim().min(1).max(300),
  channel: z.string().trim().max(200).default(''),
  durationSec: z.number().int().min(0).max(24 * 3600).default(0),
});
export type VideoInput = z.infer<typeof videoInput>;

const position = z.enum(['end', 'next']).default('end');
const itemId = z.string().min(1).max(64);

export const commandSchema = z.discriminatedUnion('type', [
  // ---- guest + host -------------------------------------------------------
  z.object({ type: z.literal('queue:add'), video: videoInput, position }),
  z.object({
    type: z.literal('queue:addMany'),
    videos: z.array(videoInput).min(1).max(LIMITS.maxAddMany),
    position,
  }),
  z.object({ type: z.literal('queue:move'), itemId, toIndex: z.number().int().min(0) }),
  z.object({ type: z.literal('queue:remove'), itemId }),
  z.object({ type: z.literal('player:skip') }),
  z.object({ type: z.literal('popup:extend') }),
  z.object({ type: z.literal('volume:set'), volume: z.number().int().min(0).max(100) }),
  z.object({
    type: z.literal('session:setNickname'),
    nickname: z.string().trim().min(1).max(LIMITS.maxNicknameLength),
  }),

  // ---- host only ----------------------------------------------------------
  z.object({ type: z.literal('player:ended'), itemId }),
  z.object({ type: z.literal('player:error'), itemId, code: z.number().int() }),
  z.object({
    type: z.literal('player:progress'),
    itemId,
    positionSec: z.number().min(0).max(24 * 3600),
    status: z.enum(['playing', 'paused', 'buffering']),
  }),
  z.object({ type: z.literal('queue:clear') }),
  z.object({ type: z.literal('mode:set'), mode: z.enum(['party', 'local']) }),
  z.object({
    type: z.literal('settings:update'),
    patch: z
      .object({
        lanPort: z.number().int().min(1024).max(65535),
        lanAddress: z.ipv4().nullable(),
        browser: z.enum(['auto', 'chrome', 'edge', 'brave', 'default']),
        splitRatio: z.number().min(0.15).max(0.6),
        controlPaneCollapsed: z.boolean(),
        volume: z.number().int().min(0).max(100),
        showCornerQr: z.boolean(),
        showUpNext: z.boolean(),
        endCurtainSec: z.number().int().min(0).max(30),
        blockedSongs: z.enum(['popup', 'skip']),
      })
      .partial(),
  }),
  z.object({ type: z.literal('settings:get') }),
  z.object({ type: z.literal('playlist:preview'), url: z.string().trim().min(1).max(500) }),
  z.object({
    type: z.literal('playlist:save'),
    url: z.string().trim().min(1).max(500),
    customName: z.string().trim().max(100).nullable().default(null),
  }),
  z.object({ type: z.literal('playlist:remove'), id: z.string().regex(PLAYLIST_ID_RE) }),
  z.object({
    type: z.literal('playlist:rename'),
    id: z.string().regex(PLAYLIST_ID_RE),
    customName: z.string().trim().max(100).nullable(),
  }),
  z.object({ type: z.literal('playlist:refresh'), id: z.string().regex(PLAYLIST_ID_RE) }),
  z.object({ type: z.literal('playlist:restoreDefaults') }),
  z.object({ type: z.literal('firewall:allow') }),
  z.object({ type: z.literal('client:log'), message: z.string().max(500) }),
  z.object({ type: z.literal('app:exit') }),
]);

export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];
/** Client-side shape: fields with defaults are optional. */
export type CommandInput = z.input<typeof commandSchema>;

const GUEST_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>([
  'queue:add',
  'queue:addMany',
  'queue:move',
  'queue:remove',
  'player:skip',
  'popup:extend',
  'volume:set',
  'session:setNickname',
]);

export function isAllowed(role: Role, type: CommandType): boolean {
  return role === 'host' || GUEST_COMMANDS.has(type);
}

/** Which rate-limit bucket a command counts against. */
export function rateBucket(type: CommandType): 'add' | 'move' | 'remove' | 'skip' | 'other' | null {
  switch (type) {
    case 'queue:add':
    case 'queue:addMany':
      return 'add';
    case 'queue:move':
      return 'move';
    case 'queue:remove':
      return 'remove';
    case 'player:skip':
      return 'skip';
    case 'player:progress':
    case 'player:ended':
    case 'player:error':
      return null; // host player events are never limited
    default:
      return 'other';
  }
}

export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

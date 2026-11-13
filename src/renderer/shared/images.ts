/**
 * A type's image (CCP's image server), through the app's local cache: the main process fetches each image once and
 * keeps it on disk (core/imageCache).
 */
export const render = (typeId: number, size = 64) => `eveimg://types/${typeId}/render?size=${size}`;

/** A type's icon (modules, charges, drones), through the same cache. */
export const icon = (typeId: number, size = 32) => `eveimg://types/${typeId}/icon?size=${size}`;

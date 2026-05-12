import type { StoreyId } from './types'

export function buildToiletRoomAreaId(storeyId: StoreyId, expressId: number): `toilet-room:${number}:${number}` {
  return `toilet-room:${storeyId}:${expressId}`
}

import { describe, expect, it } from 'vitest'
import { customRoomId, roomBody } from './roomRef'

describe('roomBody', () => {
  it('asks for the scan-based room model only when room_model is set', () => {
    expect(roomBody('sid', 'room1')).not.toHaveProperty('use_room_model')
    expect(roomBody('sid', 'room1', { room_model: true })).toMatchObject({ room_id: 'room1', use_room_model: true })
  })
  it('keeps edits alongside the room model', () => {
    const b = roomBody('sid', 'room1', { walls: 'brick', furniture: [], room_model: true })
    expect(b).toMatchObject({ use_room_model: true, materials: { walls: 'brick' }, furniture: [] })
  })
  it('never asks for a room model for a hand-entered room', () => {
    const id = customRoomId({ label: 'Den', width_m: 4, depth_m: 3, height_m: 2.5 })
    expect(roomBody('sid', id, { room_model: true })).not.toHaveProperty('use_room_model')
  })
})

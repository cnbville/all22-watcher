import { describe, expect, it } from 'vitest'
import type { GameInfo, Play } from '@shared/types'
import {
  defPersonnelLabel,
  durationLabel,
  enumLabel,
  experienceLabel,
  formatEpa,
  formatPct,
  formatSigned,
  gameDayLabel,
  gameLabel,
  gameTitle,
  heightLabel,
  ordinal,
  personnelLabel,
  playCaption,
  recordLabel,
  relativeDay,
  weekCode,
  weekName
} from './format'

const game = (over: Partial<GameInfo> = {}): GameInfo => ({
  gameId: '2025_01_DAL_PHI',
  season: 2025,
  week: 1,
  gameType: 'REG',
  gameday: '2025-09-04',
  homeTeam: 'PHI',
  awayTeam: 'DAL',
  homeScore: 24,
  awayScore: 20,
  ...over
})

const play = { qtr: 1, time: '06:41', down: 3, ydstogo: 7, yardline100: 64 } as Play

describe('format (03 §2.3)', () => {
  it('labels games', () => {
    expect(gameLabel(game(), 'PHI')).toBe('Wk 1 vs DAL')
    expect(gameLabel(game({ week: 2, homeTeam: 'KC', awayTeam: 'PHI' }), 'PHI')).toBe('Wk 2 @ KC')
    expect(gameLabel(game({ gameType: 'WC', homeTeam: 'PHI', awayTeam: 'SF' }), 'PHI')).toBe('Wild Card vs SF')
    expect(gameTitle(game())).toBe('DAL @ PHI')
    expect(weekName(game())).toBe('Week 1')
    expect(weekName(game({ gameType: 'WC' }))).toBe('Wild Card')
    expect(weekName(game({ gameType: 'DIV' }))).toBe('Divisional')
    expect(weekName(game({ gameType: 'CON' }))).toBe('Conference')
    expect(weekName(game({ gameType: 'SB' }))).toBe('Super Bowl')
    expect(weekCode(game({ gameType: 'CON' }))).toBe('CONF')
    expect(weekCode(game({ week: 12 }))).toBe('12')
  })

  it('captions a play', () => {
    expect(playCaption(game(), 'PHI', play)).toBe('Wk 1 vs DAL · Q1 06:41 · 3rd & 7')
  })

  it('formats numbers with a true minus', () => {
    expect(formatEpa(0.42)).toBe('+0.42')
    expect(formatEpa(-1.16)).toBe('−1.16')
    expect(formatEpa(0)).toBe('0.00')
    expect(formatEpa(-0.001)).toBe('0.00')
    expect(formatEpa(null)).toBe('—')
    expect(formatSigned(54)).toBe('+54')
    expect(formatSigned(-12)).toBe('−12')
    expect(formatSigned(0)).toBe('0')
    expect(formatPct(0.48)).toBe('48%')
    expect(recordLabel(11, 6)).toBe('11–6')
    expect(recordLabel(7, 9, 1)).toBe('7–9–1')
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(13)).toBe('13th')
  })

  it('formats bios', () => {
    expect(heightLabel(72)).toBe('6′0″')
    expect(heightLabel('74')).toBe('6′2″')
    expect(heightLabel('')).toBe('')
    expect(experienceLabel('0')).toBe('Rookie')
    expect(experienceLabel('1')).toBe('2nd season')
    expect(experienceLabel('7')).toBe('8th season')
    expect(experienceLabel('')).toBe('')
  })

  it('formats days and durations', () => {
    const now = new Date(2026, 9, 15, 12)
    expect(relativeDay(new Date(2026, 9, 15, 8).toISOString(), now)).toBe('Today')
    expect(relativeDay(new Date(2026, 9, 14, 23).toISOString(), now)).toBe('Yesterday')
    expect(relativeDay(new Date(2026, 9, 12, 9).toISOString(), now)).toBe('Oct 12')
    expect(relativeDay(new Date(2024, 9, 12, 9).toISOString(), now)).toBe('Oct 12, 2024')
    expect(durationLabel(9)).toBe('0:09')
    expect(durationLabel(192)).toBe('3:12')
    expect(durationLabel(3725)).toBe('1:02:05')
    expect(gameDayLabel('2025-09-07')).toBe('Sun, Sep 7')
  })

  it('labels personnel and enums', () => {
    expect(personnelLabel('1 RB, 1 TE, 3 WR')).toBe('11 personnel')
    expect(personnelLabel('1 RB, 2 TE, 2 WR, 6 OL')).toBe('12 personnel (6 OL)')
    expect(personnelLabel('weird')).toBe('weird')
    expect(defPersonnelLabel('4 DL, 3 LB, 4 DB')).toBe('Base')
    expect(defPersonnelLabel('4 DL, 2 LB, 5 DB')).toBe('Nickel')
    expect(defPersonnelLabel('3 DL, 2 LB, 6 DB')).toBe('Dime')
    expect(defPersonnelLabel('2 DL, 2 LB, 7 DB')).toBe('Quarter')
    expect(defPersonnelLabel('5 DL, 3 LB, 3 DB')).toBe('Heavy')
    expect(enumLabel('SHOTGUN')).toBe('Shotgun')
    expect(enumLabel('COVER_3')).toBe('Cover 3')
    expect(enumLabel('2_MAN')).toBe('2-Man')
    expect(enumLabel('MAN_COVERAGE')).toBe('Man')
    expect(enumLabel('ZONE_COVERAGE')).toBe('Zone')
  })
})

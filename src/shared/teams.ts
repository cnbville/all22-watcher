import type { PositionGroup, Side, Team } from './types'

export const TEAMS: Team[] = [
  { abbr: 'BUF', name: 'Buffalo Bills', nickname: 'Bills', conference: 'AFC', division: 'AFC East', color: '#00338D', color2: '#C60C30' },
  { abbr: 'MIA', name: 'Miami Dolphins', nickname: 'Dolphins', conference: 'AFC', division: 'AFC East', color: '#008E97', color2: '#FC4C02' },
  { abbr: 'NE', name: 'New England Patriots', nickname: 'Patriots', conference: 'AFC', division: 'AFC East', color: '#002244', color2: '#C60C30' },
  { abbr: 'NYJ', name: 'New York Jets', nickname: 'Jets', conference: 'AFC', division: 'AFC East', color: '#125740', color2: '#FFFFFF' },
  { abbr: 'BAL', name: 'Baltimore Ravens', nickname: 'Ravens', conference: 'AFC', division: 'AFC North', color: '#241773', color2: '#9E7C0C' },
  { abbr: 'CIN', name: 'Cincinnati Bengals', nickname: 'Bengals', conference: 'AFC', division: 'AFC North', color: '#FB4F14', color2: '#000000' },
  { abbr: 'CLE', name: 'Cleveland Browns', nickname: 'Browns', conference: 'AFC', division: 'AFC North', color: '#311D00', color2: '#FF3C00' },
  { abbr: 'PIT', name: 'Pittsburgh Steelers', nickname: 'Steelers', conference: 'AFC', division: 'AFC North', color: '#101820', color2: '#FFB612' },
  { abbr: 'HOU', name: 'Houston Texans', nickname: 'Texans', conference: 'AFC', division: 'AFC South', color: '#03202F', color2: '#A71930' },
  { abbr: 'IND', name: 'Indianapolis Colts', nickname: 'Colts', conference: 'AFC', division: 'AFC South', color: '#002C5F', color2: '#A2AAAD' },
  { abbr: 'JAX', name: 'Jacksonville Jaguars', nickname: 'Jaguars', conference: 'AFC', division: 'AFC South', color: '#006778', color2: '#D7A22A' },
  { abbr: 'TEN', name: 'Tennessee Titans', nickname: 'Titans', conference: 'AFC', division: 'AFC South', color: '#0C2340', color2: '#4B92DB' },
  { abbr: 'DEN', name: 'Denver Broncos', nickname: 'Broncos', conference: 'AFC', division: 'AFC West', color: '#FB4F14', color2: '#002244' },
  { abbr: 'KC', name: 'Kansas City Chiefs', nickname: 'Chiefs', conference: 'AFC', division: 'AFC West', color: '#E31837', color2: '#FFB81C' },
  { abbr: 'LV', name: 'Las Vegas Raiders', nickname: 'Raiders', conference: 'AFC', division: 'AFC West', color: '#000000', color2: '#A5ACAF' },
  { abbr: 'LAC', name: 'Los Angeles Chargers', nickname: 'Chargers', conference: 'AFC', division: 'AFC West', color: '#0080C6', color2: '#FFC20E' },
  { abbr: 'DAL', name: 'Dallas Cowboys', nickname: 'Cowboys', conference: 'NFC', division: 'NFC East', color: '#003594', color2: '#869397' },
  { abbr: 'NYG', name: 'New York Giants', nickname: 'Giants', conference: 'NFC', division: 'NFC East', color: '#0B2265', color2: '#A71930' },
  { abbr: 'PHI', name: 'Philadelphia Eagles', nickname: 'Eagles', conference: 'NFC', division: 'NFC East', color: '#004C54', color2: '#A5ACAF' },
  { abbr: 'WAS', name: 'Washington Commanders', nickname: 'Commanders', conference: 'NFC', division: 'NFC East', color: '#5A1414', color2: '#FFB612' },
  { abbr: 'CHI', name: 'Chicago Bears', nickname: 'Bears', conference: 'NFC', division: 'NFC North', color: '#0B162A', color2: '#C83803' },
  { abbr: 'DET', name: 'Detroit Lions', nickname: 'Lions', conference: 'NFC', division: 'NFC North', color: '#0076B6', color2: '#B0B7BC' },
  { abbr: 'GB', name: 'Green Bay Packers', nickname: 'Packers', conference: 'NFC', division: 'NFC North', color: '#203731', color2: '#FFB612' },
  { abbr: 'MIN', name: 'Minnesota Vikings', nickname: 'Vikings', conference: 'NFC', division: 'NFC North', color: '#4F2683', color2: '#FFC62F' },
  { abbr: 'ATL', name: 'Atlanta Falcons', nickname: 'Falcons', conference: 'NFC', division: 'NFC South', color: '#A71930', color2: '#000000' },
  { abbr: 'CAR', name: 'Carolina Panthers', nickname: 'Panthers', conference: 'NFC', division: 'NFC South', color: '#0085CA', color2: '#101820' },
  { abbr: 'NO', name: 'New Orleans Saints', nickname: 'Saints', conference: 'NFC', division: 'NFC South', color: '#D3BC8D', color2: '#101820' },
  { abbr: 'TB', name: 'Tampa Bay Buccaneers', nickname: 'Buccaneers', conference: 'NFC', division: 'NFC South', color: '#D50A0A', color2: '#34302B' },
  { abbr: 'ARI', name: 'Arizona Cardinals', nickname: 'Cardinals', conference: 'NFC', division: 'NFC West', color: '#97233F', color2: '#000000' },
  { abbr: 'LA', name: 'Los Angeles Rams', nickname: 'Rams', conference: 'NFC', division: 'NFC West', color: '#003594', color2: '#FFA300' },
  { abbr: 'SF', name: 'San Francisco 49ers', nickname: '49ers', conference: 'NFC', division: 'NFC West', color: '#AA0000', color2: '#B3995D' },
  { abbr: 'SEA', name: 'Seattle Seahawks', nickname: 'Seahawks', conference: 'NFC', division: 'NFC West', color: '#002244', color2: '#69BE28' }
]

export const TEAM_BY_ABBR: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [t.abbr, t]))

export const DIVISIONS = [
  'AFC East', 'AFC North', 'AFC South', 'AFC West',
  'NFC East', 'NFC North', 'NFC South', 'NFC West'
]

export const POSITION_GROUPS: PositionGroup[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'ST']

export const OFFENSE_GROUPS: PositionGroup[] = ['QB', 'RB', 'WR', 'TE', 'OL']
export const DEFENSE_GROUPS: PositionGroup[] = ['DL', 'LB', 'DB']

const GROUP_BY_POSITION: Record<string, PositionGroup> = {
  QB: 'QB',
  RB: 'RB', HB: 'RB', FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  OL: 'OL', T: 'OL', OT: 'OL', G: 'OL', OG: 'OL', C: 'OL', LT: 'OL', RT: 'OL', LG: 'OL', RG: 'OL',
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', IDL: 'DL', EDGE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  DB: 'DB', CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', SAF: 'DB', NB: 'DB',
  K: 'ST', P: 'ST', LS: 'ST', KR: 'ST', PR: 'ST'
}

export function positionGroup(position: string, depthPos = ''): PositionGroup {
  return GROUP_BY_POSITION[depthPos.toUpperCase()] ?? GROUP_BY_POSITION[position.toUpperCase()] ?? 'ST'
}

export function sideOfGroup(group: PositionGroup): Side | 'special' {
  if (OFFENSE_GROUPS.includes(group)) return 'offense'
  if (DEFENSE_GROUPS.includes(group)) return 'defense'
  return 'special'
}

export const DEFAULT_TAGS: Record<PositionGroup, [string, 'pos' | 'neg' | 'neutral'][]> = {
  QB: [['Accurate', 'pos'], ['Good read', 'pos'], ['Pocket movement', 'pos'], ['Off target', 'neg'], ['Bad read', 'neg'], ['Held ball', 'neg'], ['Turnover-worthy', 'neg'], ['Scramble', 'neutral']],
  RB: [['Broken tackle', 'pos'], ['Vision', 'pos'], ['Pass pro win', 'pos'], ['Yards after contact', 'pos'], ['Missed hole', 'neg'], ['Pass pro loss', 'neg'], ['Drop', 'neg'], ['Fumble', 'neg']],
  WR: [['Separation', 'pos'], ['Route win', 'pos'], ['Contested catch', 'pos'], ['YAC', 'pos'], ['Block win', 'pos'], ['Route loss', 'neg'], ['Drop', 'neg'], ['Block loss', 'neg']],
  TE: [['Route win', 'pos'], ['Contested catch', 'pos'], ['Run block win', 'pos'], ['Pass pro win', 'pos'], ['Route loss', 'neg'], ['Drop', 'neg'], ['Run block loss', 'neg'], ['Pressure allowed', 'neg']],
  OL: [['Run block win', 'pos'], ['Pass pro win', 'pos'], ['Pancake', 'pos'], ['Run block loss', 'neg'], ['Pressure allowed', 'neg'], ['Sack allowed', 'neg'], ['Missed assignment', 'neg'], ['Penalty', 'neg']],
  DL: [['Pressure', 'pos'], ['Sack', 'pos'], ['Run stop', 'pos'], ['Gap integrity', 'pos'], ['Double-teamed', 'neutral'], ['Washed out', 'neg'], ['Lost gap', 'neg'], ['Penalty', 'neg']],
  LB: [['Tackle', 'pos'], ['Run fit', 'pos'], ['Coverage win', 'pos'], ['Pressure', 'pos'], ['Missed tackle', 'neg'], ['Wrong fit', 'neg'], ['Coverage loss', 'neg'], ['Blocked out', 'neg']],
  DB: [['Tight coverage', 'pos'], ['PBU', 'pos'], ['Tackle', 'pos'], ['Run support', 'pos'], ['Beaten', 'neg'], ['Missed tackle', 'neg'], ['Eyes in backfield', 'neg'], ['Penalty', 'neg']],
  ST: [['Good kick', 'pos'], ['Coverage tackle', 'pos'], ['Good return', 'pos'], ['Poor kick', 'neg'], ['Missed tackle', 'neg'], ['Penalty', 'neg']]
}

export const DEFAULT_CHART_FIELDS: [string, string[]][] = [
  ['Coverage shell', ['Cover 0', 'Cover 1', 'Cover 2', 'Cover 3', 'Cover 4', 'Cover 6', '2-Man', 'Other']],
  ['Pressure', ['4-man rush', '5+ blitz', 'Sim pressure', '3-man rush']],
  ['Run concept', ['Inside zone', 'Outside zone', 'Power', 'Counter', 'Duo', 'Trap', 'Draw', 'QB run']],
  ['Pass concept', ['Quick game', 'Dropback', 'Play action', 'Screen', 'RPO', 'Boot', 'Shot play']]
]

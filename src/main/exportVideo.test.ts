import { describe, expect, it } from 'vitest'
import type { ExportPart, ExportSegment } from '@shared/exportVideo'
import { chaptersText, concatList, gapArgs, joinArgs, pickEncoder, segmentArgs, titleArgs } from './exportVideo'
import { bundledFfmpegCandidates, errorTail, parseEncoders, parseFfmpegInfo, parseFfprobeJson, parseVersion } from './ffmpeg'

const ENCODERS = `Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
`
const x264 = pickEncoder({ h264_videotoolbox: false, libx264: true })!
const plan = { width: 1920, height: 1080, fps: 30 as const }
const part = (o: Partial<ExportPart> = {}): ExportPart => ({
  clipId: 1,
  path: '/clips/a.mp4',
  angle: 'sideline',
  in: 1,
  out: 8,
  rect: { x: 0, y: 0, w: 1920, h: 1080 },
  duration: 8,
  fps: 30,
  hasAudio: false,
  ...o
})
const seg = (o: Partial<ExportSegment> = {}): ExportSegment => ({
  index: 0,
  ref: { gameId: 'g', playId: 1 },
  number: 1,
  parts: [part()],
  layout: 'single',
  duration: 7,
  caption: 'Wk 1 vs DAL · Q1 06:41 · 3rd & 7',
  ...o
})
const filterOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1]

describe('encoder choice', () => {
  it('reads an -encoders listing and prefers VideoToolbox', () => {
    expect(parseEncoders(ENCODERS)).toEqual({ h264_videotoolbox: true, libx264: true })
    expect(parseEncoders(ENCODERS.replace(/.*h264_videotoolbox.*\n/, ''))).toEqual({ h264_videotoolbox: false, libx264: true })
    expect(parseEncoders(' A....D aac   AAC\n')).toEqual({ h264_videotoolbox: false, libx264: false })
    const vt = pickEncoder(parseEncoders(ENCODERS))!
    expect(vt.name).toBe('h264_videotoolbox')
    expect(vt.args(1080)).toEqual(['-c:v', 'h264_videotoolbox', '-b:v', '10000000', '-allow_sw', '1', '-profile:v', 'high'])
    expect(x264.args(720)).toEqual(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high'])
    expect(pickEncoder({ h264_videotoolbox: false, libx264: false })).toBeNull()
  })
})

describe('segmentArgs', () => {
  it('encodes a single angle with overlays timed by enable', () => {
    const args = segmentArgs(seg(), plan, { audio: false, between: 'none' }, x264, {
      overlays: [
        { path: '/t/ov-0-0.png', from: 0, to: 7 },
        { path: '/t/ov-0-1.png', from: 1.5, to: 3 }
      ],
      out: '/t/seg-0.mp4'
    })
    expect(args.slice(0, 13)).toEqual(['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-ss', '1', '-t', '7', '-i', '/clips/a.mp4', '-loop'])
    expect(args.filter((a) => a.endsWith('.png'))).toEqual(['/t/ov-0-0.png', '/t/ov-0-1.png'])
    expect(filterOf(args)).toBe(
      '[0:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,trim=duration=7,setpts=PTS-STARTPTS[base0];' +
        "[base0][1:v]overlay=0:0:enable='between(t,0,7)'[o1];" +
        "[o1][2:v]overlay=0:0:enable='between(t,1.5,3)'[o2];" +
        '[o2]format=yuv420p[v]'
    )
    expect(args).toContain('-an')
    expect(args.slice(-9)).toEqual(['-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-t', '7', '/t/seg-0.mp4'])
  })

  it('joins Side by Side panes with hstack and holds the right pane before its start', () => {
    const s = seg({ layout: 'sideBySide', parts: [part(), part({ path: '/clips/b.mp4', angle: 'endzone', in: -0.5, out: 6.5 })] })
    const args = segmentArgs(s, plan, { audio: false, between: 'none' }, x264, { overlays: [], out: '/t/seg-0.mp4' })
    expect(args.filter((a) => a === '-i').length).toBe(2)
    // The right clip starts at 0 and is padded by the half second it starts late.
    expect(args.slice(12, 18)).toEqual(['-ss', '0', '-t', '6.5', '-i', '/clips/b.mp4'])
    const f = filterOf(args)
    expect(f).toContain('[1:v]fps=30,scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,tpad=start_mode=clone:start_duration=0.5,tpad=stop_mode=clone:stop_duration=0.5,trim=duration=7')
    expect(f).toContain('[l][r]hstack=inputs=2,pad=1920:1080:0:(oh-ih)/2:color=black,setsar=1[base0]')
  })

  it('holds the last frame and pads audio for "Hold the Last Frame"', () => {
    const args = segmentArgs(seg({ parts: [part({ hasAudio: true })] }), plan, { audio: true, between: 'hold1' }, x264, { overlays: [], out: '/t/s.mp4' })
    const f = filterOf(args)
    expect(f).toContain('[base0]tpad=stop_mode=clone:stop_duration=1[held]')
    expect(f).toContain('[0:a]aresample=48000,atrim=duration=7,asetpts=PTS-STARTPTS,apad=pad_dur=1[a]')
    expect(args.join(' ')).toContain('-map [v] -map [a] -c:a aac -b:a 160k -ar 48000 -ac 2')
    expect(args.slice(-3)).toEqual(['-t', '8', '/t/s.mp4'])
  })

  it('adds silence for clips without audio when audio is on', () => {
    const args = segmentArgs(seg(), plan, { audio: true, between: 'none' }, x264, { overlays: [{ path: '/t/o.png', from: 0, to: 7 }], out: '/t/s.mp4' })
    expect(args.join(' ')).toContain('-f lavfi -t 7 -i anullsrc=r=48000:cl=stereo')
    expect(args.join(' ')).toContain('-map [v] -map 2:a')
    expect(args).not.toContain('-an')
  })
})

describe('gaps, title card and join', () => {
  it('builds black gaps with or without silence', () => {
    expect(gapArgs(0.5, plan, false, x264, '/t/gap.mp4').join(' ')).toContain('-f lavfi -t 0.5 -i color=c=black:s=1920x1080:r=30 -map 0:v -an')
    expect(gapArgs(1, plan, true, x264, '/t/gap.mp4').join(' ')).toContain('-i anullsrc=r=48000:cl=stereo -map 0:v -map 1:a')
  })
  it('fades the title card in and out', () => {
    const args = titleArgs('/t/title.png', plan, false, x264, '/t/title.mp4')
    expect(args.join(' ')).toContain('-loop 1 -t 2.5 -i /t/title.png')
    expect(filterOf(args)).toContain('fade=t=in:st=0:d=0.3,fade=t=out:st=2.2:d=0.3')
  })
  it('writes the concat list and the join command', () => {
    expect(concatList(['/t/seg-0.mp4', "/t/it's.mp4"])).toBe("file '/t/seg-0.mp4'\nfile '/t/it'\\''s.mp4'\n")
    expect(joinArgs('/t/list.txt', '/t/chapters.txt', 'Reel', '/out/Reel.mp4.part.mp4')).toEqual([
      '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', '/t/list.txt', '-i', '/t/chapters.txt',
      '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart',
      '-metadata', 'title=Reel', '-metadata', 'comment=Exported from All-22 Watcher', '/out/Reel.mp4.part.mp4'
    ])
  })
})

describe('chaptersText', () => {
  const burnIn = { grade: true, name: true, caption: true, description: false, drawings: true, number: true, titleCard: true }
  it('writes a title chapter and one chapter per play, skipping gaps', () => {
    const segments = [seg({ duration: 7 }), seg({ index: 1, number: 2, duration: 5, caption: 'Q2 = 1st; goal' })]
    expect(chaptersText({ segments }, { between: 'black1', burnIn })).toBe(
      [';FFMETADATA1',
        '[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'END=2500', 'title=Title',
        '[CHAPTER]', 'TIMEBASE=1/1000', 'START=2500', 'END=9500', 'title=Wk 1 vs DAL · Q1 06:41 · 3rd & 7',
        '[CHAPTER]', 'TIMEBASE=1/1000', 'START=10500', 'END=15500', 'title=Q2 \\= 1st\\; goal'
      ].join('\n') + '\n'
    )
  })
  it('merges Each Angle in Turn segments of one play', () => {
    const segments = [seg({ duration: 7 }), seg({ index: 1, duration: 7 }), seg({ index: 2, number: 2, duration: 4, caption: 'next' })]
    const text = chaptersText({ segments }, { between: 'hold1', burnIn: { ...burnIn, titleCard: false } })
    expect(text.match(/START=\d+\nEND=\d+/g)).toEqual(['START=0\nEND=16000', 'START=16000\nEND=21000'])
  })
})

describe('ffmpeg helpers', () => {
  it('parses ffmpeg’s banner', () => {
    const stderr = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'Play 1.mp4':
  Duration: 00:00:05.03, start: 0.000000, bitrate: 92 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 640x360 [SAR 1:1 DAR 16:9], 88 kb/s, 29.97 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 2 kb/s (default)`
    expect(parseFfmpegInfo(stderr)).toEqual({ duration: 5.03, width: 640, height: 360, fps: 29.97, hasAudio: true, codec: 'h264' })
    expect(parseFfmpegInfo('garbage')).toEqual({ duration: null, width: null, height: null, fps: null, hasAudio: false, codec: null })
  })
  it('parses ffprobe JSON', () => {
    const json = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, avg_frame_rate: '60000/1001' }],
      format: { duration: '7.5' }
    })
    expect(parseFfprobeJson(json)).toEqual({ duration: 7.5, width: 1920, height: 1080, fps: 60000 / 1001, hasAudio: false, codec: 'hevc' })
  })
  it('reads versions and error tails', () => {
    expect(parseVersion('ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023')).toBe('6.1.1-3ubuntu5')
    expect(parseVersion('ffmpeg version n6.1.1 Copyright')).toBe('n6.1.1')
    expect(errorTail('a\n\nb\nc\n')).toBe('b c')
    expect(errorTail('')).toBe('ffmpeg failed')
  })
  it('looks for the bundled binary in the app resources, then the repo', () => {
    const c = bundledFfmpegCandidates('/Applications/All-22 Watcher.app/Contents/Resources', 'arm64')
    expect(c[0]).toBe('/Applications/All-22 Watcher.app/Contents/Resources/ffmpeg/ffmpeg')
    expect(c[1]).toMatch(/resources\/ffmpeg\/arm64\/ffmpeg$/)
  })
})

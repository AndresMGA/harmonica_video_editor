import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import './App.css'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const bucket = import.meta.env.VITE_BUCKET
const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

const defaultVideoPath =
  'exercises/chromatic/additional_melodies/amazing_grace/video.mp4'
const defaultVideoUrl =
  supabaseUrl && bucket
    ? `${supabaseUrl}/storage/v1/object/public/${bucket}/${defaultVideoPath}`
    : ''

function normalizeStorageObjectPath(value) {
  const trimmed = value.trim().replace(/^\/+/, '')

  if (!trimmed) {
    return ''
  }

  let normalizedPath = trimmed

  if (/^(chromatic|diatonic)(\/|$)/i.test(normalizedPath)) {
    normalizedPath = `exercises/${normalizedPath}`
  }

  normalizedPath = normalizedPath.replaceAll('-', '_')

  const lastSegment = normalizedPath.split('/').filter(Boolean).at(-1) ?? ''
  const hasFileExtension = /\.[^./]+$/.test(lastSegment)

  if (!hasFileExtension) {
    normalizedPath = normalizedPath.replace(/\/+$/, '')
    normalizedPath = `${normalizedPath}/video.mp4`
  }

  return normalizedPath
}

function withDefaultVideoFilename(url) {
  try {
    const parsedUrl = new URL(url)
    const pathname = parsedUrl.pathname.replace(/\/+$/, '')
    const lastSegment = pathname.split('/').filter(Boolean).at(-1) ?? ''

    if (!lastSegment || !/\.[^./]+$/.test(lastSegment)) {
      parsedUrl.pathname = `${pathname}/video.mp4`
    }

    return parsedUrl.toString()
  } catch {
    return url
  }
}

function toPlayableUrl(value) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return withDefaultVideoFilename(trimmed)
  }

  if (!supabaseUrl || !bucket) {
    return ''
  }

  const normalizedPath = normalizeStorageObjectPath(trimmed)
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${normalizedPath}`
}

function toPublicStorageUrl(storagePath) {
  if (!supabaseUrl || !bucket || !storagePath) {
    return ''
  }

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`
}

function formatExerciseTitle(path) {
  const parts = path.split('/').filter(Boolean)
  const fallback = parts.at(-1) ?? path
  return fallback.replaceAll('_', ' ')
}

function getBaseName(path) {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function isHiddenFolderPath(path) {
  return getBaseName(path).startsWith('.')
}

function getFileExtension(fileName) {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

function getHarmonicaHoleCount(storagePath) {
  const normalizedPath = `/${storagePath ?? ''}`

  if (/\/chromatic(\/|$)/i.test(normalizedPath)) {
    return 12
  }

  if (/\/diatonic(\/|$)/i.test(normalizedPath)) {
    return 10
  }

  return null
}

function localTmpPath(fileName) {
  return `/home/andres/harmonica_video_editor/tmp/${fileName}`
}

function contentTypeForPath(filePath) {
  const extension = getFileExtension(filePath)

  switch (extension) {
    case '.json':
      return 'application/json'
    case '.svg':
      return 'image/svg+xml'
    case '.mp4':
      return 'video/mp4'
    default:
      return 'application/octet-stream'
  }
}

function preferredSvgStoragePath(folderPath, files) {
  const svgFiles = (files ?? []).filter((file) => file.extension === '.svg')
  const preferred =
    svgFiles.find((file) => file.name === 'score-1.svg') ||
    svgFiles.find((file) => file.name === 'score.svg') ||
    svgFiles[0]

  return preferred?.path ?? `${folderPath}/score.svg`
}

async function readLocalFileBlob(filePath) {
  const result = await window.electronAPI.readLocalFile({ filePath })

  if (!result.ok || !result.base64) {
    throw new Error(result.message || `Failed to read ${filePath}`)
  }

  const binary = atob(result.base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], {
    type: contentTypeForPath(filePath),
  })
}

function isFolderItem(item) {
  return (
    item.id == null ||
    (!item.metadata && !item.updated_at && !item.created_at && !item.last_accessed_at)
  )
}

function createFolderNode(path, depth) {
  return {
    path,
    depth,
    title: formatExerciseTitle(path),
    status: 'idle',
    message: '',
    children: [],
    isExpanded: false,
    files: [],
  }
}

async function listBucketFolder(prefix = '', depth = 0) {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })

  if (error) {
    throw error
  }

  const folders = []
  const files = []
  let hasKeepMarker = false

  for (const item of data ?? []) {
    const nextPath = prefix ? `${prefix}/${item.name}` : item.name

    if (isFolderItem(item)) {
      folders.push(createFolderNode(nextPath, depth))
      continue
    }

    if (item.name === '.keep') {
      hasKeepMarker = true
      continue
    }

    files.push({
      path: nextPath,
      name: item.name,
      extension: getFileExtension(item.name),
      parentPath: prefix,
    })
  }

  folders.sort((left, right) => left.path.localeCompare(right.path))
  files.sort((left, right) => left.path.localeCompare(right.path))

  return {
    children: folders,
    files,
    hasKeepMarker,
  }
}

function updateTreeNode(nodes, targetPath, updater) {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node)
    }

    if (!node.children.length) {
      return node
    }

    return {
      ...node,
      children: updateTreeNode(node.children, targetPath, updater),
    }
  })
}

function replaceTreeNode(nodes, targetPath, nextNode) {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return nextNode
    }

    if (!node.children.length) {
      return node
    }

    return {
      ...node,
      children: replaceTreeNode(node.children, targetPath, nextNode),
    }
  })
}

function findTreeNode(nodes, targetPath) {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node
    }

    if (node.children.length) {
      const match = findTreeNode(node.children, targetPath)
      if (match) {
        return match
      }
    }
  }

  return null
}

async function listFolderObjectPaths(prefix = '') {
  const folder = await listBucketFolder(prefix, 0)
  const filePaths = folder.files.map((file) => file.path)

  for (const child of folder.children) {
    filePaths.push(...(await listFolderObjectPaths(child.path)))
  }

  if (folder.hasKeepMarker) {
    filePaths.push(`${prefix}/.keep`)
  }

  return filePaths
}

async function moveFolderObjects(sourcePrefix, targetPrefix) {
  const objectPaths = await listFolderObjectPaths(sourcePrefix)

  for (const objectPath of objectPaths) {
    const nextPath = `${targetPrefix}${objectPath.slice(sourcePrefix.length)}`
    const { error } = await supabase.storage.from(bucket).move(objectPath, nextPath)

    if (error) {
      throw error
    }
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00'
  }

  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainder = totalSeconds % 60

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
      remainder,
    ).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

const timelineTracks = [
  { id: 'video', label: 'Video', accent: 'track-accent-video' },
  {
    id: 'stereo',
    label: 'FrontLR\nHarm',
    accent: 'track-accent-stereo',
    channelIndexes: [0, 1],
  },
  {
    id: 'center',
    label: 'Center\nMetro',
    accent: 'track-accent-center',
    channelIndexes: [2],
  },
  { id: 'lfe', label: 'LFE\n(Empty)', accent: 'track-accent-lfe', channelIndexes: [3] },
  {
    id: 'surround',
    label: 'RearLR\nAccomp',
    accent: 'track-accent-surround',
    channelIndexes: [4, 5],
  },
]

const waveformResolution = 180
const maxNegativeStartSeconds = 2

function sampleWaveform(channelData, sampleCount = waveformResolution) {
  if (!channelData?.length) {
    return []
  }

  const blockSize = Math.max(1, Math.floor(channelData.length / sampleCount))
  const samples = []

  for (let index = 0; index < sampleCount; index += 1) {
    const start = index * blockSize
    const end = Math.min(start + blockSize, channelData.length)
    let peak = 0

    for (let cursor = start; cursor < end; cursor += 1) {
      const amplitude = Math.abs(channelData[cursor])
      if (amplitude > peak) {
        peak = amplitude
      }
    }

    samples.push(Number.isFinite(peak) ? peak : 0)
  }

  return samples
}

function buildWaveformPath(samples) {
  if (!samples.length) {
    return ''
  }

  const top = []
  const bottom = []
  const step = samples.length > 1 ? 100 / (samples.length - 1) : 100

  samples.forEach((sample, index) => {
    const x = index * step
    const clamped = Math.min(Math.max(sample, 0), 1)
    const offset = clamped * 42
    top.push(`${x.toFixed(2)},${(50 - offset).toFixed(2)}`)
    bottom.push(`${x.toFixed(2)},${(50 + offset).toFixed(2)}`)
  })

  return `M ${top.join(' L ')} L ${bottom.reverse().join(' L ')} Z`
}

function mergeWaveforms(channels) {
  if (!channels.length) {
    return []
  }

  const merged = Array.from({ length: waveformResolution }, (_, index) => {
    let peak = 0

    channels.forEach((samples) => {
      const value = samples[index] ?? 0
      if (value > peak) {
        peak = value
      }
    })

    return peak
  })

  return merged
}

function stopTimelineSeek(event) {
  event.stopPropagation()
}

function getTrackOffsetPercent(delayMs, durationSeconds) {
  if (!durationSeconds) {
    return 0
  }

  return clamp((delayMs / 1000 / durationSeconds) * 100, -100, 100)
}

function getDerivedTrackDelays(rangeStartSeconds) {
  const syncedDelayMs = Math.round(rangeStartSeconds * 1000)

  return {
    stereo: 0,
    center: syncedDelayMs,
    lfe: 0,
    surround: syncedDelayMs,
  }
}

function getStorageObjectPath(value) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return normalizeStorageObjectPath(trimmed)
  }

  try {
    const parsedUrl = new URL(trimmed)
    const marker = `/storage/v1/object/public/${bucket}/`
    const markerIndex = parsedUrl.pathname.indexOf(marker)

    if (markerIndex === -1) {
      return ''
    }

    return normalizeStorageObjectPath(parsedUrl.pathname.slice(markerIndex + marker.length))
  } catch {
    return ''
  }
}

function buildExportCommand(storageObjectPath, rangeStart, rangeEnd) {
  const startMs = Math.round(rangeStart * 1000)
  const durationMs = Math.round(Math.max(rangeEnd - rangeStart, 0) * 1000)
  return `./ffmpeg_scripts/script.sh ${startMs} ${JSON.stringify(storageObjectPath)} ${durationMs}`
}

function buildWaveformStyle(
  delayMs,
  mediaDurationSeconds,
  domainStartSeconds,
  domainDurationSeconds,
  verticalZoom,
) {
  const mediaStartPercent = getTimelinePercent(0, domainStartSeconds, domainDurationSeconds)
  const mediaWidthPercent =
    domainDurationSeconds > 0 ? (mediaDurationSeconds / domainDurationSeconds) * 100 : 100
  const offsetPercent = getTrackOffsetPercent(delayMs, domainDurationSeconds)

  return {
    left: `${mediaStartPercent + offsetPercent}%`,
    width: `${mediaWidthPercent}%`,
    transform: `scaleY(${verticalZoom})`,
  }
}

function getTimelinePercent(timeSeconds, domainStartSeconds, domainDurationSeconds) {
  if (!domainDurationSeconds) {
    return 0
  }

  return ((timeSeconds - domainStartSeconds) / domainDurationSeconds) * 100
}

const initialTrackVolumes = {
  stereo: 100,
  center: 100,
  lfe: 0,
  surround: 100,
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// This component stays internal to this file and is only rendered by the wrapper below.
// eslint-disable-next-line react/prop-types
function VideoEditor({ initialVideoInput = defaultVideoUrl || defaultVideoPath, onBack }) {
  const videoRef = useRef(null)
  const timelineViewportRef = useRef(null)
  const autoScrollingRef = useRef(false)
  const audioGraphRef = useRef(null)
  const decodedAudioBufferRef = useRef(null)
  const exportLogPanelRef = useRef(null)
  const trackVolumesRef = useRef(initialTrackVolumes)
  const rangeStartRef = useRef(0)
  const trimDragRef = useRef(null)
  const [videoElement, setVideoElement] = useState(null)
  const submittedVideo = initialVideoInput
  const [loadError, setLoadError] = useState('')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [waveforms, setWaveforms] = useState({})
  const [waveformStatus, setWaveformStatus] = useState('idle')
  const [waveformError, setWaveformError] = useState('')
  const [timelineZoom, setTimelineZoom] = useState(1.8)
  const [waveformZoom, setWaveformZoom] = useState(1.8)
  const [autoFollow, setAutoFollow] = useState(true)
  const [trackVolumes, setTrackVolumes] = useState(initialTrackVolumes)
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  const [audioRoutingError, setAudioRoutingError] = useState('')
  const [exportState, setExportState] = useState({ status: 'idle', message: '' })
  const [exportLogs, setExportLogs] = useState([])
  const [activeExportRunId, setActiveExportRunId] = useState('')

  const videoUrl = toPlayableUrl(submittedVideo)
  const storageObjectPath = getStorageObjectPath(submittedVideo) || getStorageObjectPath(videoUrl)
  const effectiveRangeStart = clamp(rangeStart, -maxNegativeStartSeconds, duration || 0)
  const effectiveRangeEnd =
    duration > 0 ? clamp(rangeEnd || duration, effectiveRangeStart, duration) : 0
  const derivedTrackDelays = getDerivedTrackDelays(effectiveRangeStart)
  const timelineDomainStart = -maxNegativeStartSeconds
  const timelineDomainDuration = duration + maxNegativeStartSeconds
  const clippedCurrentTime = clamp(currentTime, effectiveRangeStart, effectiveRangeEnd || currentTime)
  const progress =
    duration > 0
      ? getTimelinePercent(clamp(currentTime, 0, duration), timelineDomainStart, timelineDomainDuration)
      : 0
  const rangeStartPercent =
    duration > 0
      ? getTimelinePercent(effectiveRangeStart, timelineDomainStart, timelineDomainDuration)
      : 0
  const rangeEndPercent =
    duration > 0
      ? getTimelinePercent(effectiveRangeEnd, timelineDomainStart, timelineDomainDuration)
      : 100
  const timelineWidth = `${Math.max(timelineZoom * 100, 100)}%`

  useEffect(() => {
    trackVolumesRef.current = trackVolumes
  }, [trackVolumes])

  useEffect(() => {
    rangeStartRef.current = effectiveRangeStart
  }, [effectiveRangeStart])

  useEffect(() => {
    if (exportLogPanelRef.current) {
      exportLogPanelRef.current.scrollTop = exportLogPanelRef.current.scrollHeight
    }
  }, [exportLogs])

  useEffect(() => {
    if (!window.electronAPI?.onExportCommandLog) {
      return undefined
    }

    return window.electronAPI.onExportCommandLog((payload) => {
      if (!payload?.runId || payload.runId !== activeExportRunId) {
        return
      }

      const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false })
      setExportLogs((currentLogs) => [
        ...currentLogs,
        `[${timestamp}] ${payload.stream}: ${payload.message}`,
      ])
    })
  }, [activeExportRunId])

  useEffect(() => {
    if (!videoUrl) {
      setWaveforms({})
      setWaveformStatus('idle')
      setWaveformError('')
      decodedAudioBufferRef.current = null
      return undefined
    }

    let isCancelled = false
    const controller = new AbortController()
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext

    if (!AudioContextCtor) {
      setWaveforms({})
      setWaveformStatus('error')
      setWaveformError('This browser does not support audio decoding for waveform previews.')
      return undefined
    }

    const decodeWaveforms = async () => {
      setWaveformStatus('loading')
      setWaveformError('')
      setWaveforms({})

      let audioContext

      try {
        const response = await fetch(videoUrl, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Waveform fetch failed with ${response.status}`)
        }

        const fileBuffer = await response.arrayBuffer()
        audioContext = new AudioContextCtor()
        const audioBuffer = await audioContext.decodeAudioData(fileBuffer.slice(0))

        if (isCancelled) {
          return
        }

        decodedAudioBufferRef.current = audioBuffer

        const nextWaveforms = {}
        timelineTracks
          .filter((track) => Array.isArray(track.channelIndexes))
          .forEach((track) => {
            const sampledChannels = track.channelIndexes
              .filter((channelIndex) => channelIndex < audioBuffer.numberOfChannels)
              .map((channelIndex) => sampleWaveform(audioBuffer.getChannelData(channelIndex)))

            if (sampledChannels.length) {
              nextWaveforms[track.id] =
                sampledChannels.length === 1 ? sampledChannels[0] : mergeWaveforms(sampledChannels)
            }
          })

        setWaveforms(nextWaveforms)
        setWaveformStatus('ready')
      } catch (error) {
        if (error.name === 'AbortError' || isCancelled) {
          return
        }

        setWaveforms({})
        setWaveformStatus('error')
        setWaveformError('Waveform decoding failed for this video in the current browser.')
      } finally {
        if (audioContext) {
          audioContext.close().catch(() => {})
        }
      }
    }

    decodeWaveforms()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [videoUrl])

  useEffect(() => {
    if (!videoElement || !videoUrl) {
      setAudioRoutingError('')
      return undefined
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) {
      setAudioRoutingError('Track volume controls are not available in this browser.')
      return undefined
    }

    let isDisposed = false
    let resumeHandler
    let syncPlayback
    let stopPlayback

    const createTrackBuffer = (context, audioBuffer, channelIndexes) => {
      const outputChannels = channelIndexes.length > 1 ? 2 : 1
      const trackBuffer = context.createBuffer(
        outputChannels,
        audioBuffer.length,
        audioBuffer.sampleRate,
      )

      if (channelIndexes.length === 1) {
        const sourceChannel = audioBuffer.getChannelData(channelIndexes[0])
        trackBuffer.copyToChannel(sourceChannel, 0)
        return trackBuffer
      }

      channelIndexes.forEach((channelIndex, outputIndex) => {
        const sourceChannel = audioBuffer.getChannelData(channelIndex)
        trackBuffer.copyToChannel(sourceChannel, outputIndex)
      })

      return trackBuffer
    }

    const setupAudioRouting = async () => {
      try {
        const context = new AudioContextCtor()
        const trackNodes = {}

        timelineTracks
          .filter((track) => Array.isArray(track.channelIndexes))
          .forEach((track) => {
            const gainNode = context.createGain()
            gainNode.gain.value = (trackVolumesRef.current[track.id] ?? 100) / 100
            gainNode.connect(context.destination)

            trackNodes[track.id] = {
              buffer: null,
              channelIndexes: track.channelIndexes,
              gainNode,
              sourceNode: null,
            }
          })

        const stopSources = () => {
          Object.values(trackNodes).forEach((trackNode) => {
            if (trackNode.sourceNode) {
              try {
                trackNode.sourceNode.stop()
              } catch {
                // Source may already be stopped during rapid seek/pause cycles.
              }
              trackNode.sourceNode.disconnect()
              trackNode.sourceNode = null
            }
          })
        }

        const startSourcesForCurrentTime = () => {
          const audioBuffer = decodedAudioBufferRef.current
          if (!audioBuffer) {
            return
          }

          stopSources()

          const now = context.currentTime
          const videoTime = videoElement.currentTime

          Object.entries(trackNodes).forEach(([trackId, trackNode]) => {
            if (!trackNode.buffer) {
              trackNode.buffer = createTrackBuffer(context, audioBuffer, trackNode.channelIndexes)
            }

            const offsetSeconds =
              (getDerivedTrackDelays(rangeStartRef.current)[trackId] ?? 0) / 1000
            const sourceNode = context.createBufferSource()
            sourceNode.buffer = trackNode.buffer
            sourceNode.connect(trackNode.gainNode)

            const startAt = Math.max(offsetSeconds - videoTime, 0)
            const bufferOffset = Math.max(videoTime - offsetSeconds, 0)

            if (bufferOffset >= sourceNode.buffer.duration) {
              return
            }

            sourceNode.start(now + startAt, bufferOffset)
            trackNode.sourceNode = sourceNode
          })
        }

        resumeHandler = () => {
          if (context.state === 'suspended') {
            context.resume().catch(() => {})
          }
        }

        syncPlayback = () => {
          if (videoElement.paused) {
            stopSources()
            return
          }

          if (context.state === 'suspended') {
            context.resume().catch(() => {})
          }

          startSourcesForCurrentTime()
        }

        window.addEventListener('pointerdown', resumeHandler)
        window.addEventListener('keydown', resumeHandler)
        videoElement.addEventListener('play', syncPlayback)
        videoElement.addEventListener('pause', stopSources)
        videoElement.addEventListener('seeked', syncPlayback)
        videoElement.addEventListener('ratechange', syncPlayback)
        videoElement.addEventListener('click', resumeHandler)

        if (context.state === 'suspended') {
          context.resume().catch(() => {})
        }

        if (isDisposed) {
          stopSources()
          await context.close()
          return
        }

        stopPlayback = stopSources
        audioGraphRef.current = { context, trackNodes, syncPlayback, stopPlayback }
        setAudioRoutingError('')
      } catch {
        if (!isDisposed) {
          setAudioRoutingError('Track volume controls could not be attached to this video.')
        }
      }
    }

    setupAudioRouting()

    return () => {
      isDisposed = true

      if (resumeHandler) {
        window.removeEventListener('pointerdown', resumeHandler)
        window.removeEventListener('keydown', resumeHandler)
        videoElement.removeEventListener('play', syncPlayback)
        videoElement.removeEventListener('pause', stopPlayback)
        videoElement.removeEventListener('seeked', syncPlayback)
        videoElement.removeEventListener('ratechange', syncPlayback)
        videoElement.removeEventListener('click', resumeHandler)
      }

      const currentGraph = audioGraphRef.current
      if (currentGraph) {
        currentGraph.stopPlayback?.()
        currentGraph.context.close().catch(() => {})
        audioGraphRef.current = null
      }
    }
  }, [videoElement, videoUrl])

  useEffect(() => {
    const trackNodes = audioGraphRef.current?.trackNodes
    if (!trackNodes) {
      return
    }

    Object.entries(trackVolumes).forEach(([trackId, volume]) => {
      const trackNode = trackNodes[trackId]
      if (!trackNode) return
      trackNode.gainNode.gain.setValueAtTime(volume / 100, audioGraphRef.current.context.currentTime)
    })
  }, [trackVolumes])

  useEffect(() => {
    const graph = audioGraphRef.current
    if (!graph) {
      return
    }

    if (!videoRef.current?.paused) {
      graph.syncPlayback?.()
    }
  }, [effectiveRangeStart])

  useEffect(() => {
    const viewport = timelineViewportRef.current

    if (!viewport || !autoFollow || duration <= 0) {
      return
    }

    const innerWidth = viewport.scrollWidth
    const viewportWidth = viewport.clientWidth
    const playheadPosition =
      (getTimelinePercent(clamp(currentTime, 0, duration), timelineDomainStart, timelineDomainDuration) /
        100) *
      innerWidth
    const leftLimit = viewport.scrollLeft + viewportWidth * 0.2
    const rightLimit = viewport.scrollLeft + viewportWidth * 0.8

    if (playheadPosition < leftLimit || playheadPosition > rightLimit) {
      autoScrollingRef.current = true
      const targetLeft = Math.max(playheadPosition - viewportWidth * 0.35, 0)
      viewport.scrollTo({
        left: Math.min(targetLeft, Math.max(innerWidth - viewportWidth, 0)),
        behavior: 'smooth',
      })

      window.setTimeout(() => {
        autoScrollingRef.current = false
      }, 180)
    }
  }, [autoFollow, currentTime, duration, timelineDomainDuration, timelineDomainStart, timelineZoom])

  useEffect(() => {
    const handlePointerMove = (event) => {
      const activeDrag = trimDragRef.current
      if (!activeDrag || duration <= 0) {
        return
      }

      const ratio = clamp((event.clientX - activeDrag.rect.left) / activeDrag.rect.width, 0, 1)
      const nextTime = timelineDomainStart + timelineDomainDuration * ratio

      if (activeDrag.edge === 'start') {
        const nextStart = clamp(nextTime, timelineDomainStart, effectiveRangeEnd)
        setRangeStart(nextStart)
        if (videoRef.current && nextStart >= 0 && videoRef.current.currentTime < nextStart) {
          videoRef.current.currentTime = nextStart
          setCurrentTime(nextStart)
        }
      } else {
        const nextEnd = clamp(nextTime, effectiveRangeStart, duration)
        setRangeEnd(nextEnd)
        if (videoRef.current && videoRef.current.currentTime > nextEnd) {
          videoRef.current.currentTime = nextEnd
          setCurrentTime(nextEnd)
        }
      }
    }

    const handlePointerUp = () => {
      trimDragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [effectiveRangeEnd, effectiveRangeStart, timelineDomainDuration, timelineDomainStart, duration])

  useEffect(() => {
    if (duration <= 0) {
      return
    }

    setRangeEnd((currentRangeEnd) => {
      if (currentRangeEnd <= 0 || currentRangeEnd > duration) {
        return duration
      }
      return currentRangeEnd
    })
  }, [duration])

  const handleSeek = (event) => {
    if (!videoRef.current || duration <= 0) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1)
    const timelineTime = timelineDomainStart + timelineDomainDuration * ratio
    videoRef.current.currentTime = clamp(timelineTime, 0, duration)
    setCurrentTime(videoRef.current.currentTime)
  }

  const handleSetRangeStart = () => {
    const nextStart = clamp(currentTime, 0, effectiveRangeEnd || duration || 0)
    setRangeStart(nextStart)

    if (videoRef.current && videoRef.current.currentTime < nextStart) {
      videoRef.current.currentTime = nextStart
      setCurrentTime(nextStart)
    }
  }

  const handleSetRangeEnd = () => {
    const nextEnd = clamp(currentTime, effectiveRangeStart, duration || 0)
    setRangeEnd(nextEnd)

    if (videoRef.current && videoRef.current.currentTime > nextEnd) {
      videoRef.current.currentTime = nextEnd
      setCurrentTime(nextEnd)
    }
  }

  const pushExportLog = (message) => {
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setExportLogs((currentLogs) => [...currentLogs, `[${timestamp}] ${message}`])
  }

  const handleExport = async () => {
    if (!storageObjectPath) {
      setExportState({
        status: 'error',
        message: 'Save requires a valid Supabase storage path.',
      })
      return
    }

    if (effectiveRangeEnd <= effectiveRangeStart) {
      setExportState({
        status: 'error',
        message: 'End time must be greater than start time before exporting.',
      })
      return
    }

    if (!window.electronAPI?.runExportCommand) {
      setExportState({
        status: 'error',
        message: 'Save execution is only available in the Electron app.',
      })
      return
    }

    try {
      setExportLogs([])
      const exportCommand = buildExportCommand(
        storageObjectPath,
        effectiveRangeStart,
        effectiveRangeEnd,
      )
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      setActiveExportRunId(runId)
      setExportState({
        status: 'loading',
        message: 'Running save command...',
      })

      pushExportLog(`Save: source path ${storageObjectPath}`)
      pushExportLog(
        `Save: trim ${effectiveRangeStart.toFixed(3)}s -> ${effectiveRangeEnd.toFixed(3)}s`,
      )
      pushExportLog(
        `Save: metro/accomp offset ${Math.round(effectiveRangeStart * 1000)}ms from video start`,
      )
      if (effectiveRangeStart < 0) {
        pushExportLog(
          `Save: negative start will prepend ${Math.round(Math.abs(effectiveRangeStart) * 1000)}ms of blank video`,
        )
      }
      pushExportLog(`Command: ${exportCommand}`)
      pushExportLog('Command: starting process')

      const result = await window.electronAPI.runExportCommand({
        command: exportCommand,
        runId,
      })

      setActiveExportRunId('')

      if (result.ok) {
        pushExportLog(
          `Command: completed${typeof result.code === 'number' ? ` with exit code ${result.code}` : ''}`,
        )
        setExportState({
          status: 'success',
          message: 'Changes saved.',
        })
        return
      }

      pushExportLog(
        `Command: failed${typeof result.code === 'number' ? ` with exit code ${result.code}` : ''}${result.signal ? ` (${result.signal})` : ''}`,
      )
      if (result.message) {
        pushExportLog(`Error: ${result.message}`)
      }
      setExportState({
        status: 'error',
        message: result.message || 'Save command failed.',
      })
    } catch (error) {
      setActiveExportRunId('')
      pushExportLog(`Save: failed - ${error instanceof Error ? error.message : 'unknown error'}`)
      setExportState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Save failed.',
      })
    }
  }

  return (
    <main className="app-shell">
      <section className="panel">
        {onBack ? (
          <div className="editor-header">
            <button type="button" className="secondary-button" onClick={onBack}>
              Back To Browser
            </button>
            <span className="editor-header-path">{storageObjectPath || submittedVideo}</span>
          </div>
        ) : null}
        <div className="workspace-grid">
          <div className="sidebar-column">
            <div className="export-actions">
              <button
                type="button"
                onClick={handleExport}
                disabled={!videoUrl || exportState.status === 'loading'}
              >
                {exportState.status === 'loading' ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setExportLogs([])
                  setActiveExportRunId('')
                  setExportState({ status: 'idle', message: '' })
                }}
                disabled={exportState.status === 'loading'}
              >
                Clear Log
              </button>
            </div>
            {exportState.status !== 'idle' ? (
              <div className="export-progress" aria-hidden="true">
                <div
                  className={`export-progress-bar ${
                    exportState.status === 'loading'
                      ? 'export-progress-bar-loading'
                      : exportState.status === 'success'
                        ? 'export-progress-bar-success'
                        : 'export-progress-bar-error'
                  }`}
                />
              </div>
            ) : null}
            {exportState.message ? (
              <p
                className={`export-status ${
                  exportState.status === 'error'
                    ? 'export-status-error'
                    : exportState.status === 'success'
                      ? 'export-status-success'
                      : ''
                }`}
              >
                {exportState.message}
              </p>
            ) : null}
            {exportLogs.length ? (
              <pre ref={exportLogPanelRef} className="export-log-panel">{exportLogs.join('\n')}</pre>
            ) : null}
          </div>

          <div className="preview-column">
            {videoUrl ? (
              <div className="player-card">
                <video
                  key={videoUrl}
                  ref={(node) => {
                    videoRef.current = node
                    setVideoElement(node)
                  }}
                  className="video-player"
                  crossOrigin="anonymous"
                  controls
                  muted
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    setDuration(event.currentTarget.duration || 0)
                    setCurrentTime(event.currentTarget.currentTime || 0)
                    setRangeStart(0)
                    setRangeEnd(event.currentTarget.duration || 0)
                    setLoadError('')
                  }}
                  onTimeUpdate={(event) => {
                    const nextTime = event.currentTarget.currentTime

                    if (effectiveRangeEnd > effectiveRangeStart && nextTime >= effectiveRangeEnd) {
                      event.currentTarget.currentTime = effectiveRangeEnd
                      event.currentTarget.pause()
                      setCurrentTime(effectiveRangeEnd)
                      return
                    }

                    if (nextTime < effectiveRangeStart) {
                      event.currentTarget.currentTime = effectiveRangeStart
                      setCurrentTime(effectiveRangeStart)
                      return
                    }

                    setCurrentTime(nextTime)
                  }}
                  onError={() => setLoadError('The video could not be loaded from that URL.')}
                >
                  <source src={videoUrl} type="video/mp4" />
                  Your browser does not support HTML5 video.
                </video>
                {loadError ? <p className="error-message">{loadError}</p> : null}
              </div>
            ) : (
              <p className="error-message">
                A playable URL could not be built. Check your `.env` values or enter a full URL.
              </p>
            )}
          </div>
        </div>

        {videoUrl ? (
          <div className="timeline-section">
            <section className="timeline-card" aria-label="Media timeline">
              <div className="timeline-summary">
                <strong>Timeline</strong>
                <span>{formatTime(clippedCurrentTime)} / {formatTime(effectiveRangeEnd)}</span>
              </div>

              <div className="timeline-toolbar">
                <label className="zoom-control" htmlFor="timeline-zoom">
                  <span>Zoom</span>
                  <input
                    id="timeline-zoom"
                    type="range"
                    min="1"
                    max="6"
                    step="0.2"
                    value={timelineZoom}
                    onChange={(event) => setTimelineZoom(Number(event.target.value))}
                  />
                  <span>{timelineZoom.toFixed(1)}x</span>
                </label>
                <label className="zoom-control" htmlFor="waveform-zoom">
                  <span>Wave</span>
                  <input
                    id="waveform-zoom"
                    type="range"
                    min="1"
                    max="16"
                    step="0.1"
                    value={waveformZoom}
                    onChange={(event) => setWaveformZoom(Number(event.target.value))}
                  />
                  <span>{waveformZoom.toFixed(1)}x</span>
                </label>
                <label className="follow-toggle">
                  <input
                    type="checkbox"
                    checked={autoFollow}
                    onChange={(event) => setAutoFollow(event.target.checked)}
                  />
                  <span>Auto-follow playhead</span>
                </label>
                <label className="range-control" htmlFor="range-start">
                  <span>Start</span>
                  <input
                    id="range-start"
                    type="number"
                    min={-maxNegativeStartSeconds}
                    max={duration || 0}
                    step="0.1"
                    value={rangeStart}
                    onClick={stopTimelineSeek}
                    onPointerDown={stopTimelineSeek}
                    onChange={(event) => {
                      const nextStart = Number(event.target.value)
                      const clampedStart = Number.isFinite(nextStart)
                        ? clamp(
                            nextStart,
                            -maxNegativeStartSeconds,
                            effectiveRangeEnd || duration || 0,
                          )
                        : 0
                      setRangeStart(clampedStart)
                      if (
                        videoRef.current &&
                        clampedStart >= 0 &&
                        videoRef.current.currentTime < clampedStart
                      ) {
                        videoRef.current.currentTime = clampedStart
                        setCurrentTime(clampedStart)
                      }
                    }}
                  />
                  <span>s</span>
                  <button type="button" className="range-action" onClick={handleSetRangeStart}>
                    Set Start
                  </button>
                </label>
                <label className="range-control" htmlFor="range-end">
                  <span>End</span>
                  <input
                    id="range-end"
                    type="number"
                    min={effectiveRangeStart}
                    max={duration || 0}
                    step="0.1"
                    value={rangeEnd}
                    onClick={stopTimelineSeek}
                    onPointerDown={stopTimelineSeek}
                    onChange={(event) => {
                      const nextEnd = Number(event.target.value)
                      const clampedEnd = Number.isFinite(nextEnd)
                        ? clamp(nextEnd, effectiveRangeStart, duration || 0)
                        : duration || 0
                      setRangeEnd(clampedEnd)
                      if (videoRef.current && videoRef.current.currentTime > clampedEnd) {
                        videoRef.current.currentTime = clampedEnd
                        setCurrentTime(clampedEnd)
                      }
                    }}
                  />
                  <span>s</span>
                  <button type="button" className="range-action" onClick={handleSetRangeEnd}>
                    Set End
                  </button>
                </label>
              </div>

              <div
                ref={timelineViewportRef}
                className="timeline-viewport"
                onScroll={() => {
                  if (autoScrollingRef.current) {
                    return
                  }

                  if (!autoFollow) {
                    return
                  }

                  if (videoRef.current && !videoRef.current.paused) {
                    setAutoFollow(false)
                  }
                }}
              >
                <div
                  className="timeline-grid"
                  style={{ width: timelineWidth }}
                  role="slider"
                  tabIndex={0}
                  aria-label="Seek timeline"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(clamp(currentTime, 0, duration))}
                  onKeyDown={(event) => {
                    if (!videoRef.current || duration <= 0) {
                      return
                    }

                    if (event.key === ' ' || event.key === 'Spacebar') {
                      event.preventDefault()

                      if (videoRef.current.paused) {
                        videoRef.current.play().catch(() => {})
                      } else {
                        videoRef.current.pause()
                      }

                      return
                    }

                    const step = event.shiftKey ? 5 : 1

                    if (event.key === 'ArrowRight') {
                      event.preventDefault()
                      videoRef.current.currentTime = Math.min(
                        videoRef.current.currentTime + step,
                        effectiveRangeEnd,
                      )
                      setCurrentTime(videoRef.current.currentTime)
                    }

                    if (event.key === 'ArrowLeft') {
                      event.preventDefault()
                      videoRef.current.currentTime = Math.max(
                        videoRef.current.currentTime - step,
                        effectiveRangeStart,
                      )
                      setCurrentTime(videoRef.current.currentTime)
                    }
                  }}
                >
                  {timelineTracks.map((track) => (
                    <div key={track.id} className="timeline-row">
                      <div className="track-label">{track.label}</div>
                      {Array.isArray(track.channelIndexes) ? (
                        <div
                          className="inline-track-controls"
                          onClick={stopTimelineSeek}
                          onPointerDown={stopTimelineSeek}
                        >
                          <label className="inline-volume-control" htmlFor={`volume-${track.id}`}>
                            <span className="inline-control-title">Vol</span>
                            <span className="inline-input-wrap">
                              <input
                                id={`volume-${track.id}`}
                                type="number"
                                min="0"
                                max="100"
                                step="1"
                                value={trackVolumes[track.id] ?? 100}
                                onClick={stopTimelineSeek}
                                onPointerDown={stopTimelineSeek}
                                onChange={(event) => {
                                  const nextVolume = Number(event.target.value)
                                  setTrackVolumes((currentVolumes) => ({
                                    ...currentVolumes,
                                    [track.id]: Number.isFinite(nextVolume)
                                      ? Math.min(Math.max(Math.round(nextVolume), 0), 100)
                                      : 0,
                                  }))

                                  const context = audioGraphRef.current?.context
                                  if (context?.state === 'suspended') {
                                    context.resume().catch(() => {})
                                  }
                                }}
                              />
                              <span className="inline-control-suffix">%</span>
                            </span>
                          </label>
                        </div>
                      ) : (
                        <div className="inline-track-controls inline-track-controls-empty" aria-hidden="true" />
                      )}
                      <div
                        className={`track-lane ${
                          track.id === 'video'
                            ? 'track-lane-video'
                            : track.id === 'lfe'
                              ? 'track-lane-lfe'
                              : 'track-lane-audio'
                        }`}
                        onClick={handleSeek}
                      >
                        <div className={`track-fill ${track.accent}`} />
                        {duration > 0 ? (
                          <>
                            <div
                              className="trim-region"
                              style={{
                                left: `${rangeStartPercent}%`,
                                width: `${Math.max(rangeEndPercent - rangeStartPercent, 0)}%`,
                              }}
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              className="trim-handle trim-handle-start"
                              style={{ left: `${rangeStartPercent}%` }}
                              onClick={stopTimelineSeek}
                              onPointerDown={(event) => {
                                stopTimelineSeek(event)
                                trimDragRef.current = {
                                  edge: 'start',
                                  rect: event.currentTarget.parentElement.getBoundingClientRect(),
                                }
                              }}
                              aria-label="Drag start trim"
                            />
                            <button
                              type="button"
                              className="trim-handle trim-handle-end"
                              style={{ left: `${rangeEndPercent}%` }}
                              onClick={stopTimelineSeek}
                              onPointerDown={(event) => {
                                stopTimelineSeek(event)
                                trimDragRef.current = {
                                  edge: 'end',
                                  rect: event.currentTarget.parentElement.getBoundingClientRect(),
                                }
                              }}
                              aria-label="Drag end trim"
                            />
                          </>
                        ) : null}
                        {track.id === 'video' ? (
                          <div className="video-track-body" aria-hidden="true" />
                        ) : waveforms[track.id]?.length ? (
                          <svg
                            className="waveform-svg"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            style={{
                              ...buildWaveformStyle(
                                derivedTrackDelays[track.id] ?? 0,
                                duration,
                                timelineDomainStart,
                                timelineDomainDuration,
                                track.id === 'stereo' ? waveformZoom : 1,
                              ),
                            }}
                            aria-hidden="true"
                          >
                            <path d={buildWaveformPath(waveforms[track.id])} className="waveform-path" />
                          </svg>
                        ) : (
                          <div
                            className="waveform-placeholder"
                            style={{
                              ...buildWaveformStyle(
                                derivedTrackDelays[track.id] ?? 0,
                                duration,
                                timelineDomainStart,
                                timelineDomainDuration,
                                track.id === 'stereo' ? waveformZoom : 1,
                              ),
                            }}
                            aria-hidden="true"
                          />
                        )}
                        <div
                          className="track-playhead"
                          style={{ left: `${progress}%` }}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  ))}

                  <div className="timeline-scale timeline-scale-wide" aria-hidden="true">
                    <span>-{formatTime(maxNegativeStartSeconds)}</span>
                    <span>{formatTime(duration / 2)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
              </div>

              <div className="timeline-status">
                {waveformStatus === 'loading' ? (
                  <span>Decoding 5.1 audio to draw channel waveforms…</span>
                ) : null}
                {waveformStatus === 'error' ? <span>{waveformError}</span> : null}
                {audioRoutingError ? <span>{audioRoutingError}</span> : null}
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  )
}

/* eslint-disable react/prop-types */
function SvgViewer({ file, onBack }) {
  const svgUrl = toPublicStorageUrl(file.path)

  return (
    <main className="app-shell">
      <section className="panel">
        <div className="editor-header">
          <button type="button" className="secondary-button" onClick={onBack}>
            Back To Browser
          </button>
          <span className="editor-header-path">{file.path}</span>
        </div>
        <div className="svg-viewer-panel">
          <div className="svg-viewer-meta">
            <strong>{file.name}</strong>
            <span>A4 Preview</span>
          </div>
          <div className="svg-viewer-canvas">
            {svgUrl ? (
              <div className="svg-viewer-page">
                <img className="svg-viewer-image" src={svgUrl} alt={file.name} />
              </div>
            ) : (
              <p className="browser-status export-status-error">Unable to build the SVG URL.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
/* eslint-enable react/prop-types */

/* eslint-disable react/prop-types */
// Internal recursive tree renderer for the bucket browser.
function BrowserTreeNode({
  node,
  onToggle,
  onOpenFile,
  onStartCreateFolder,
  onStartAddFile,
  onStartUpdateMedia,
  onStartRenameFolder,
  onDeleteFolder,
  updateMediaState,
  onCloseUpdateMedia,
  onToggleUpdateMediaOption,
  onSubmitUpdateMedia,
  onCancelCreateFolder,
  onChangeCreateFolderName,
  onSubmitCreateFolder,
  onCancelRename,
  onChangeRenameName,
  onSubmitRenameFolder,
  onStartRenameFile,
  onRenameFile,
  onDeleteFile,
  createFolderParentPath,
  createFolderName,
  creatingFolderPath,
  renameTargetPath,
  renameName,
  deletingFolderPath,
  deletingFilePath,
  renamingPath,
  openingFilePath,
  museScoreLogPath,
  museScoreLogs,
  updateMediaLogPath,
  updateMediaLogs,
}) {
  const hasChildren = node.children.length > 0
  const hasFiles = node.files.length > 0
  const canExpand =
    hasChildren || hasFiles || node.status === 'idle' || node.status === 'loading' || node.message
  const isCreatingHere = createFolderParentPath === node.path
  const isRenamingFolderHere = renameTargetPath === node.path
  const isUpdatingMediaHere = updateMediaState.folderPath === node.path
  const canManageFiles =
    node.status === 'ready' && node.children.every((childNode) => isHiddenFolderPath(childNode.path))
  const createFolderInputRef = useRef(null)
  const renameFolderInputRef = useRef(null)
  const renameFileInputRef = useRef(null)
  const museScoreLogRef = useRef(null)
  const updateMediaLogRef = useRef(null)

  useEffect(() => {
    if (isCreatingHere && createFolderInputRef.current) {
      createFolderInputRef.current.focus()
      createFolderInputRef.current.setSelectionRange(
        createFolderInputRef.current.value.length,
        createFolderInputRef.current.value.length,
      )
    }
  }, [isCreatingHere])

  useEffect(() => {
    if (isRenamingFolderHere && renameFolderInputRef.current) {
      renameFolderInputRef.current.focus()
      renameFolderInputRef.current.select()
    }
  }, [isRenamingFolderHere])

  useEffect(() => {
    if (renameTargetPath && renameFileInputRef.current) {
      renameFileInputRef.current.focus()
      renameFileInputRef.current.select()
    }
  }, [renameTargetPath])

  useEffect(() => {
    if (museScoreLogRef.current && museScoreLogPath && museScoreLogs.length) {
      museScoreLogRef.current.scrollTop = museScoreLogRef.current.scrollHeight
    }
  }, [museScoreLogPath, museScoreLogs])

  useEffect(() => {
    if (updateMediaLogRef.current && updateMediaLogPath === node.path && updateMediaLogs.length) {
      updateMediaLogRef.current.scrollTop = updateMediaLogRef.current.scrollHeight
    }
  }, [node.path, updateMediaLogPath, updateMediaLogs])

  return (
    <li className="tree-node">
      <div className="tree-row-shell">
        <button
          type="button"
          className="tree-row tree-row-button"
          style={{ '--tree-depth': node.depth }}
          onClick={() => onToggle(node)}
          disabled={!canExpand}
          aria-label={node.isExpanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
        >
          <div className="tree-row-main">
            <span className="tree-toggle" aria-hidden="true">
              {node.isExpanded ? '▾' : '▸'}
            </span>
            <div className="tree-labels">
              <strong>{node.title}</strong>
              <code>{node.path}</code>
            </div>
          </div>
        </button>
        <div className="tree-row-inline-actions">
          {isCreatingHere ? (
            <form
              className="tree-inline-form"
              onSubmit={(event) => {
                event.preventDefault()
                onSubmitCreateFolder(node)
              }}
            >
              <input
                ref={createFolderInputRef}
                className="tree-inline-input"
                value={createFolderName}
                onChange={(event) => onChangeCreateFolderName(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="folder_name"
              />
              <button
                type="submit"
                className="tree-inline-action"
                disabled={creatingFolderPath === node.path || !createFolderName.trim()}
              >
                {creatingFolderPath === node.path ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                className="tree-inline-action tree-inline-action-muted"
                onClick={onCancelCreateFolder}
                disabled={creatingFolderPath === node.path}
              >
                Cancel
              </button>
            </form>
          ) : isRenamingFolderHere ? (
            <form
              className="tree-inline-form"
              onSubmit={(event) => {
                event.preventDefault()
                onSubmitRenameFolder(node)
              }}
            >
              <input
                ref={renameFolderInputRef}
                className="tree-inline-input"
                value={renameName}
                onChange={(event) => onChangeRenameName(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="folder_name"
              />
              <button
                type="submit"
                className="tree-inline-action"
                disabled={renamingPath === node.path || !renameName.trim()}
              >
                {renamingPath === node.path ? 'Renaming...' : 'Rename'}
              </button>
              <button
                type="button"
                className="tree-inline-action tree-inline-action-muted"
                onClick={onCancelRename}
                disabled={renamingPath === node.path}
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              {canManageFiles ? (
                <button
                  type="button"
                  className="tree-inline-action"
                  onClick={() => onStartUpdateMedia(node)}
                >
                  Update Media
                </button>
              ) : null}
              {canManageFiles ? (
                <button
                  type="button"
                  className="tree-inline-action"
                  onClick={() => onStartAddFile(node)}
                >
                  Add File
                </button>
              ) : null}
              <button
                type="button"
                className="tree-inline-action"
                onClick={() => onStartCreateFolder(node)}
              >
                + New Folder
              </button>
                <button
                  type="button"
                  className="tree-inline-action"
                  onClick={() => onStartRenameFolder(node)}
                  disabled={renamingPath === node.path}
                >
                  {renamingPath === node.path ? 'Renaming...' : 'Rename'}
              </button>
              <button
                type="button"
                className="tree-inline-action tree-inline-action-danger"
                onClick={() => onDeleteFolder(node)}
                disabled={!canManageFiles || deletingFolderPath === node.path}
              >
                {deletingFolderPath === node.path ? 'Deleting...' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>

      {node.isExpanded ? (
        <div className="tree-node-body" style={{ '--tree-depth': node.depth }}>
          {node.status === 'loading' ? <p className="tree-node-status">Loading...</p> : null}
          {node.status === 'error' ? (
            <p className="tree-node-status export-status-error">{node.message}</p>
          ) : null}
          {isUpdatingMediaHere ? (
            <div className="update-dropdown">
              <div className="update-dropdown-header">
                <div>
                  <p className="eyebrow">Update Media</p>
                  <h2>{updateMediaState.folderPath}</h2>
                </div>
              </div>
              <div className="dialog-options">
                <label className="dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={updateMediaState.updateJson}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation()
                      onToggleUpdateMediaOption('updateJson')
                    }}
                  />
                  <span>Update .json</span>
                </label>
                <label className="dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={updateMediaState.updateSvg}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation()
                      onToggleUpdateMediaOption('updateSvg')
                    }}
                  />
                  <span>Update .svg</span>
                </label>
                <label className="dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={updateMediaState.updateHarmonicaAudio}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation()
                      onToggleUpdateMediaOption('updateHarmonicaAudio')
                    }}
                  />
                  <span>Update harmonica audio</span>
                </label>
                <label className="dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={updateMediaState.updateAccompanimentAudio}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation()
                      onToggleUpdateMediaOption('updateAccompanimentAudio')
                    }}
                  />
                  <span>Update accompaniment audio</span>
                </label>
                <label className="dialog-checkbox">
                  <input
                    type="checkbox"
                    checked={updateMediaState.updateMetronomeAudio}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation()
                      onToggleUpdateMediaOption('updateMetronomeAudio')
                    }}
                  />
                  <span>Update metronome audio</span>
                </label>
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void onSubmitUpdateMedia()
                  }}
                >
                  Run Update
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onCloseUpdateMedia()
                  }}
                >
                  Cancel
                </button>
              </div>
              {updateMediaLogPath === node.path ? (
                <pre ref={updateMediaLogRef} className="tree-file-log-panel">
                  {updateMediaLogs.length
                    ? updateMediaLogs.join('\n')
                    : 'Waiting for media generation to start ...'}
                </pre>
              ) : null}
            </div>
          ) : null}
          {node.isExpanded && node.status === 'ready' && node.files.length ? (
            <ul className="tree-file-list">
              {node.files.map((file) => (
                <li key={file.path} className="tree-file-shell">
                  <div className="tree-file-row">
                    {renameTargetPath === file.path ? (
                      <form
                        className="tree-file-rename-form"
                        onSubmit={(event) => {
                          event.preventDefault()
                          onRenameFile(file)
                        }}
                      >
                        <input
                          ref={renameFileInputRef}
                          className="tree-inline-input"
                          value={renameName}
                          onChange={(event) => onChangeRenameName(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          placeholder="file_name.ext"
                        />
                        <button
                          type="submit"
                          className="tree-inline-action"
                          disabled={renamingPath === file.path || !renameName.trim()}
                        >
                          {renamingPath === file.path ? 'Renaming...' : 'Rename'}
                        </button>
                        <button
                          type="button"
                          className="tree-inline-action tree-inline-action-muted"
                          onClick={onCancelRename}
                          disabled={renamingPath === file.path}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className={`tree-file-button ${
                          openingFilePath === file.path ? 'tree-file-button-opening' : ''
                        }`}
                        onDoubleClick={() => onOpenFile(file)}
                        disabled={openingFilePath === file.path || deletingFilePath === file.path}
                        aria-busy={openingFilePath === file.path || deletingFilePath === file.path}
                      >
                        <span className="tree-file-name">
                          {file.name}
                          {openingFilePath === file.path ? '  Opening...' : ''}
                        </span>
                        <span className="tree-file-path">{file.path}</span>
                      </button>
                    )}
                    <div className="tree-file-actions">
                      <button
                        type="button"
                        className="tree-inline-action"
                        onClick={() => onStartRenameFile(file)}
                        disabled={deletingFilePath === file.path || openingFilePath === file.path || renamingPath === file.path}
                      >
                        {renamingPath === file.path ? 'Renaming...' : 'Rename'}
                      </button>
                      <button
                        type="button"
                        className="tree-inline-action tree-inline-action-danger"
                        onClick={() => onDeleteFile(file)}
                        disabled={deletingFilePath === file.path || openingFilePath === file.path || renamingPath === file.path}
                      >
                        {deletingFilePath === file.path ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                  {museScoreLogPath === file.path ? (
                    <pre ref={museScoreLogRef} className="tree-file-log-panel">
                      {museScoreLogs.length
                        ? museScoreLogs.join('\n')
                        : 'Waiting for MuseScore to open ...'}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {node.isExpanded && node.status === 'ready' && node.children.length ? (
            <ul className="tree-list">
              {node.children.map((childNode) => (
                <BrowserTreeNode
                  key={childNode.path}
                  node={childNode}
                  onToggle={onToggle}
                  onOpenFile={onOpenFile}
                  onStartCreateFolder={onStartCreateFolder}
                  onStartAddFile={onStartAddFile}
                  onStartUpdateMedia={onStartUpdateMedia}
                  onStartRenameFolder={onStartRenameFolder}
                  onDeleteFolder={onDeleteFolder}
                  updateMediaState={updateMediaState}
                  onCloseUpdateMedia={onCloseUpdateMedia}
                  onToggleUpdateMediaOption={onToggleUpdateMediaOption}
                  onSubmitUpdateMedia={onSubmitUpdateMedia}
                  onCancelCreateFolder={onCancelCreateFolder}
                  onChangeCreateFolderName={onChangeCreateFolderName}
                  onSubmitCreateFolder={onSubmitCreateFolder}
                  onCancelRename={onCancelRename}
                  onChangeRenameName={onChangeRenameName}
                  onSubmitRenameFolder={onSubmitRenameFolder}
                  onStartRenameFile={onStartRenameFile}
                  onRenameFile={onRenameFile}
                  onDeleteFile={onDeleteFile}
                  createFolderParentPath={createFolderParentPath}
                  createFolderName={createFolderName}
                  creatingFolderPath={creatingFolderPath}
                  renameTargetPath={renameTargetPath}
                  renameName={renameName}
                  deletingFolderPath={deletingFolderPath}
                  deletingFilePath={deletingFilePath}
                  renamingPath={renamingPath}
                  openingFilePath={openingFilePath}
                  museScoreLogPath={museScoreLogPath}
                  museScoreLogs={museScoreLogs}
                  updateMediaLogPath={updateMediaLogPath}
                  updateMediaLogs={updateMediaLogs}
                />
              ))}
            </ul>
          ) : null}
          {node.isExpanded &&
          node.status === 'ready' &&
          !node.children.length &&
          !node.files.length &&
          !node.message ? (
            <p className="tree-node-status">This folder is empty.</p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
/* eslint-enable react/prop-types */

function App() {
  const [view, setView] = useState('browser')
  const [selectedVideoInput, setSelectedVideoInput] = useState(defaultVideoPath)
  const [selectedSvgFile, setSelectedSvgFile] = useState(null)
  const [browserState, setBrowserState] = useState({
    status: 'loading',
    message: '',
    nodes: [],
  })
  const [scoreState, setScoreState] = useState({ status: 'idle', message: '' })
  const [museScoreLogs, setMuseScoreLogs] = useState([])
  const [museScoreLogPath, setMuseScoreLogPath] = useState('')
  const [updateMediaLogs, setUpdateMediaLogs] = useState([])
  const [updateMediaLogPath, setUpdateMediaLogPath] = useState('')
  const [activeUpdateMediaRunId, setActiveUpdateMediaRunId] = useState('')
  const [openScoreSession, setOpenScoreSession] = useState(null)
  const [openingFilePath, setOpeningFilePath] = useState('')
  const [createFolderParentPath, setCreateFolderParentPath] = useState('')
  const [createFolderName, setCreateFolderName] = useState('')
  const [creatingFolderPath, setCreatingFolderPath] = useState('')
  const [renameTargetPath, setRenameTargetPath] = useState('')
  const [renameName, setRenameName] = useState('')
  const [uploadTargetFolderPath, setUploadTargetFolderPath] = useState('')
  const [deletingFolderPath, setDeletingFolderPath] = useState('')
  const [deletingFilePath, setDeletingFilePath] = useState('')
  const [renamingPath, setRenamingPath] = useState('')
  const [updateMediaState, setUpdateMediaState] = useState({
    folderPath: '',
    scoreFilePath: '',
    videoFilePath: '',
    updateJson: true,
    updateSvg: true,
    updateHarmonicaAudio: false,
    updateAccompanimentAudio: true,
    updateMetronomeAudio: true,
  })

  useEffect(() => {
    let isCancelled = false

    async function loadBrowserTree() {
      if (!supabase || !bucket) {
        setBrowserState({
          status: 'error',
          message: 'Supabase storage is not configured. Check `.env`.',
          nodes: [],
        })
        return
      }

      setBrowserState({
        status: 'loading',
        message: '',
        nodes: [],
      })

      try {
        const rootFolder = await listBucketFolder('', 0)

        if (!isCancelled) {
          setBrowserState({
            status: 'ready',
            message: rootFolder.children.length ? '' : 'No folders were found in this bucket.',
            nodes: rootFolder.children,
          })
        }
      } catch (error) {
        if (!isCancelled) {
          setBrowserState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Failed to load the bucket browser.',
            nodes: [],
          })
        }
      }
    }

    loadBrowserTree()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onMuseScoreLog) {
      return undefined
    }

    return window.electronAPI.onMuseScoreLog((payload) => {
      if (payload.storagePath !== museScoreLogPath) {
        return
      }

      if (payload.message.includes('Goodbye!!')) {
        setMuseScoreLogPath('')
        setMuseScoreLogs([])
        return
      }

      setMuseScoreLogs((currentLogs) => [
        ...currentLogs.slice(-39),
        `[${payload.stream}] ${payload.message}`,
      ])
    })
  }, [museScoreLogPath])

  useEffect(() => {
    if (!window.electronAPI?.onExportCommandLog) {
      return undefined
    }

    return window.electronAPI.onExportCommandLog((payload) => {
      if (!payload?.runId || payload.runId !== activeUpdateMediaRunId) {
        return
      }

      const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false })
      setUpdateMediaLogs((currentLogs) => [
        ...currentLogs,
        `[${timestamp}] ${payload.stream}: ${payload.message}`,
      ])
    })
  }, [activeUpdateMediaRunId])

  const refreshFolderNode = async (node) => {
    const folder = await listBucketFolder(node.path, node.depth + 1)

    if (folder.hasKeepMarker && (folder.children.length > 0 || folder.files.length > 0)) {
      await supabase.storage.from(bucket).remove([`${node.path}/.keep`])
    }

    setBrowserState((currentState) => ({
      ...currentState,
      nodes: replaceTreeNode(currentState.nodes, node.path, {
        ...node,
        status: 'ready',
        message: '',
        children: folder.children,
        files: folder.files,
        isExpanded: true,
      }),
    }))
  }

  const refreshNodeParent = async (path) => {
    const parentPath = path.split('/').slice(0, -1).join('/')

    if (!parentPath) {
      const rootFolder = await listBucketFolder('', 0)
      setBrowserState((currentState) => ({
        ...currentState,
        status: 'ready',
        message: rootFolder.children.length ? '' : 'No folders were found in this bucket.',
        nodes: rootFolder.children,
      }))
      return
    }

    const parentNode = findTreeNode(browserState.nodes, parentPath)
    if (parentNode) {
      await refreshFolderNode(parentNode)
    }
  }

  const handleToggleNode = async (node) => {
    if (node.isExpanded) {
      setBrowserState((currentState) => ({
        ...currentState,
        nodes: updateTreeNode(currentState.nodes, node.path, (currentNode) => ({
          ...currentNode,
          isExpanded: false,
        })),
      }))
      return
    }

    setBrowserState((currentState) => ({
      ...currentState,
      nodes: updateTreeNode(currentState.nodes, node.path, (currentNode) => ({
        ...currentNode,
        isExpanded: true,
        status: currentNode.status === 'idle' ? 'loading' : currentNode.status,
      })),
    }))

    if (node.status !== 'idle') {
      return
    }

    try {
      await refreshFolderNode(node)
    } catch (error) {
      setBrowserState((currentState) => ({
        ...currentState,
        nodes: updateTreeNode(currentState.nodes, node.path, (currentNode) => ({
          ...currentNode,
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Failed to load this folder.',
        })),
      }))
    }
  }

  const handleOpenFile = async (file) => {
    setOpeningFilePath(file.path)

    if (file.extension === '.mp4') {
      setSelectedVideoInput(file.path)
      setView('editor')
      return
    }

    if (file.extension === '.svg') {
      setSelectedSvgFile(file)
      setView('svg')
      return
    }

    if (file.extension === '.json') {
      if (!window.electronAPI?.openFileInVSCode) {
        setScoreState({
          status: 'error',
          message: 'Opening JSON files in VS Code is only available in the Electron app.',
        })
        setOpeningFilePath('')
        return
      }

      setScoreState({
        status: 'loading',
        message: `Opening ${file.path} in VS Code...`,
      })

      const result = await window.electronAPI.openFileInVSCode({
        url: toPublicStorageUrl(file.path),
        storagePath: file.path,
      })

      setScoreState(
        result.ok
          ? {
              status: 'success',
              message: `Opened in ${result.command}: ${result.filePath}`,
            }
          : {
              status: 'error',
              message: result.message || 'Failed to open the file in VS Code.',
            },
      )
      setOpeningFilePath('')
      return
    }

    if (file.extension !== '.mscz') {
      setScoreState({
        status: 'error',
        message: `No action is configured for ${file.name}.`,
      })
      setOpeningFilePath('')
      return
    }

    if (!window.electronAPI?.openScoreInMuseScore) {
      setScoreState({
        status: 'error',
        message: 'Opening scores in MuseScore is only available in the Electron app.',
      })
      setOpeningFilePath('')
      return
    }

    setScoreState({
      status: 'loading',
      message: `Opening ${file.path} in MuseScore...`,
    })
    setMuseScoreLogPath(file.path)
    setMuseScoreLogs([])

    const result = await window.electronAPI.openScoreInMuseScore({
      url: toPublicStorageUrl(file.path),
      storagePath: file.path,
    })

    setScoreState(
      result.ok
        ? {
            status: 'success',
            message: `Opened in ${result.command}: ${result.filePath}`,
          }
        : {
            status: 'error',
            message: result.message || 'Failed to open the score in MuseScore.',
          },
    )
    setOpenScoreSession(
      result.ok
        ? {
            storagePath: file.path,
            localFilePath: result.filePath,
          }
        : null,
    )
    setOpeningFilePath('')
  }

  const handleStartCreateFolder = async (node) => {
    setCreateFolderParentPath(node.path)
    setCreateFolderName('')

    if (!node.isExpanded) {
      await handleToggleNode(node)
    }
  }

  const handleStartAddFile = async (node) => {
    setUploadTargetFolderPath(node.path)
    const input = document.getElementById('folder-upload-input')
    input?.click()
  }

  const handleStartUpdateMedia = (node) => {
    console.log('[update-media] open dialog', node.path)
    if (updateMediaState.folderPath === node.path) {
      handleCloseUpdateMedia()
      return
    }

    const preferredScoreFile =
      node.files.find((file) => file.extension === '.mscz' && file.name === 'song.mscz') ||
      node.files.find((file) => file.extension === '.mscz' && file.name === 'score.mscz') ||
      node.files.find((file) => file.extension === '.mscz') ||
      null
    const existingVideoFile =
      node.files.find((file) => file.extension === '.mp4' && file.name === 'video.mp4') || null

    setUpdateMediaState({
      folderPath: node.path,
      scoreFilePath: preferredScoreFile?.path ?? '',
      videoFilePath: existingVideoFile?.path ?? '',
      updateJson: true,
      updateSvg: true,
      updateHarmonicaAudio: false,
      updateAccompanimentAudio: true,
      updateMetronomeAudio: true,
    })
  }

  const handleCloseUpdateMedia = () => {
    console.log('[update-media] close dialog')
    setUpdateMediaState((currentState) => ({
      ...currentState,
      folderPath: '',
      scoreFilePath: '',
      videoFilePath: '',
    }))
    setActiveUpdateMediaRunId('')
  }

  const handleToggleUpdateMediaOption = (key) => {
    setUpdateMediaState((currentState) => ({
      ...currentState,
      [key]: !currentState[key],
    }))
  }

  const handleSubmitUpdateMedia = async () => {
    console.log('[update-media] submit clicked', updateMediaState)
    setScoreState({
      status: 'loading',
      message: `Starting media update for ${updateMediaState.folderPath || 'selected folder'}...`,
    })

    if (!window.electronAPI?.runMediaGeneration) {
      console.log('[update-media] electronAPI.runMediaGeneration missing')
      setScoreState({
        status: 'error',
        message: 'Update media is only available in the Electron app.',
      })
      return
    }

    const folderPath = updateMediaState.folderPath
    const expectedStoragePath = updateMediaState.scoreFilePath
    const existingVideoStoragePath = updateMediaState.videoFilePath
    const nHoles = getHarmonicaHoleCount(folderPath)
    console.log('[update-media] resolved inputs', {
      folderPath,
      expectedStoragePath,
      existingVideoStoragePath,
      nHoles,
      openScoreSession,
    })

    if (!folderPath || !expectedStoragePath || !nHoles) {
      setScoreState({
        status: 'error',
        message: `Could not determine the score file or harmonica type for ${folderPath}.`,
      })
      return
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const matchingLocalScorePath =
      openScoreSession?.storagePath === expectedStoragePath
        ? openScoreSession.localFilePath
        : ''
    const usedEditedLocalScore = Boolean(matchingLocalScorePath)
    const audioUpdateRequested =
      updateMediaState.updateHarmonicaAudio ||
      updateMediaState.updateAccompanimentAudio ||
      updateMediaState.updateMetronomeAudio
    const pushUpdateMediaLog = (message) => {
      const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false })
      setUpdateMediaLogs((currentLogs) => [...currentLogs, `[${timestamp}] ${message}`])
    }

    setScoreState({
      status: 'loading',
      message: `Generating media for ${folderPath}...`,
    })
    setUpdateMediaLogPath(folderPath)
    setUpdateMediaLogs([])
    setActiveUpdateMediaRunId(runId)
    pushUpdateMediaLog(`Preparing generation for ${expectedStoragePath}`)
    pushUpdateMediaLog(`nHoles=${nHoles}`)
    pushUpdateMediaLog(
      `updates json=${updateMediaState.updateJson} svg=${updateMediaState.updateSvg} harmonica=${updateMediaState.updateHarmonicaAudio} accompaniment=${updateMediaState.updateAccompanimentAudio} metronome=${updateMediaState.updateMetronomeAudio}`,
    )

    try {
      console.log('[update-media] invoking electronAPI.runMediaGeneration')
      const result = await window.electronAPI.runMediaGeneration({
        inputScorePath: matchingLocalScorePath,
        scoreUrl: toPublicStorageUrl(expectedStoragePath),
        storagePath: expectedStoragePath,
        inputVideoPath: '',
        videoUrl: existingVideoStoragePath ? toPublicStorageUrl(existingVideoStoragePath) : '',
        videoStoragePath: existingVideoStoragePath,
        nHoles,
        updateJson: updateMediaState.updateJson,
        updateSvg: updateMediaState.updateSvg,
        updateHarmonica: updateMediaState.updateHarmonicaAudio,
        updateAccompaniment: updateMediaState.updateAccompanimentAudio,
        updateMetronome: updateMediaState.updateMetronomeAudio,
        runId,
      })
      console.log('[update-media] result', JSON.stringify(result))
      setActiveUpdateMediaRunId('')

      setScoreState(
        result.ok
          ? {
              status: 'success',
              message: `Generated media for ${folderPath}.`,
            }
          : {
              status: 'error',
              message: result.message || `Failed to generate media for ${folderPath}.`,
            },
      )

      if (result.ok) {
        pushUpdateMediaLog('Generation finished successfully.')
        pushUpdateMediaLog('Preparing uploads...')
        const folderListing = await listBucketFolder(folderPath, 0)

        const uploadTargets = []

        if (updateMediaState.updateJson) {
          uploadTargets.push({
            localPath: localTmpPath('events.json'),
            storagePath: `${folderPath}/events.json`,
          })
        }

        if (updateMediaState.updateSvg) {
          uploadTargets.push({
            localPath: localTmpPath('score.svg'),
            storagePath: preferredSvgStoragePath(folderPath, folderListing.files),
          })
        }

        if (audioUpdateRequested) {
          uploadTargets.push({
            localPath: localTmpPath('video.mp4'),
            storagePath: `${folderPath}/video.mp4`,
          })
        }

        if (usedEditedLocalScore) {
          uploadTargets.push({
            localPath: matchingLocalScorePath,
            storagePath: expectedStoragePath,
          })
          pushUpdateMediaLog(
            `Will also upload edited score back to ${expectedStoragePath}`,
          )
        }

        const undoFolderPath = `${folderPath}/.undo`
        const undoStamp = new Date().toISOString().replaceAll(':', '-')
        const existingFilePaths = new Set(folderListing.files.map((file) => file.path))

        if (uploadTargets.length) {
          pushUpdateMediaLog(`Ensuring ${undoFolderPath} exists`)
          await supabase.storage
            .from(bucket)
            .upload(`${undoFolderPath}/.keep`, new Blob(['keep']), {
              upsert: true,
              contentType: 'text/plain',
            })
        }

        for (const target of uploadTargets) {
          if (existingFilePaths.has(target.storagePath)) {
            const undoPath = `${undoFolderPath}/${undoStamp}-${getBaseName(target.storagePath)}`
            pushUpdateMediaLog(`Moving ${target.storagePath} -> ${undoPath}`)
            const { error: moveError } = await supabase.storage
              .from(bucket)
              .move(target.storagePath, undoPath)

            if (moveError) {
              throw moveError
            }
          } else {
            pushUpdateMediaLog(`No existing ${target.storagePath} to move`)
          }
        }

        for (const target of uploadTargets) {
          pushUpdateMediaLog(`Uploading ${target.storagePath}`)
          const fileBlob = await readLocalFileBlob(target.localPath)
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(target.storagePath, fileBlob, {
              upsert: true,
              contentType: contentTypeForPath(target.storagePath),
            })

          if (uploadError) {
            throw uploadError
          }
        }

        pushUpdateMediaLog('Upload step finished successfully.')

        const targetNode = findTreeNode(browserState.nodes, folderPath)
        if (targetNode) {
          await refreshFolderNode(targetNode)
        }

        setScoreState({
          status: 'success',
          message: `Generated and uploaded media for ${folderPath}.`,
        })
      } else {
        pushUpdateMediaLog(
          `Generation failed: ${result.message || 'script exited with an error'}`,
        )
      }
    } catch (error) {
      setActiveUpdateMediaRunId('')
      pushUpdateMediaLog(
        `Generation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
      setScoreState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to generate media.',
      })
    }
  }

  const handleCancelCreateFolder = () => {
    if (creatingFolderPath) {
      return
    }

    setCreateFolderParentPath('')
    setCreateFolderName('')
  }

  const handleCreateFolder = async (node) => {
    if (!supabase || !bucket) {
      setScoreState({
        status: 'error',
        message: 'Supabase storage is not configured. Check `.env`.',
      })
      return
    }

    const normalizedName = createFolderName.trim().replace(/^\/+|\/+$/g, '')

    if (!normalizedName) {
      setScoreState({
        status: 'error',
        message: 'Enter a folder name.',
      })
      return
    }

    const normalizedPath = `${node.path}/${normalizedName}`
    setCreatingFolderPath(node.path)

    setScoreState({
      status: 'loading',
      message: `Creating folder ${normalizedPath}...`,
    })

    const markerPath = `${normalizedPath}/.keep`
    const { error } = await supabase.storage
      .from(bucket)
      .upload(markerPath, new Blob(['keep']), {
        upsert: false,
        contentType: 'text/plain',
      })

    if (error) {
      setScoreState({
        status: 'error',
        message: error.message || 'Failed to create the folder.',
      })
      setCreatingFolderPath('')
      return
    }

    setScoreState({
      status: 'success',
      message: `Created folder ${normalizedPath}`,
    })
    await refreshFolderNode(node)
    setCreatingFolderPath('')
    setCreateFolderParentPath('')
    setCreateFolderName('')
  }

  const handleUploadFile = async (event) => {
    const file = event.target.files?.[0]
    const targetFolderPath = uploadTargetFolderPath
    event.target.value = ''

    if (!file || !targetFolderPath) {
      return
    }

    setScoreState({
      status: 'loading',
      message: `Uploading ${file.name} to ${targetFolderPath}...`,
    })

    const uploadPath = `${targetFolderPath}/${file.name}`
    const { error } = await supabase.storage.from(bucket).upload(uploadPath, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

    if (error) {
      setScoreState({
        status: 'error',
        message: error.message || 'Failed to upload the file.',
      })
      setUploadTargetFolderPath('')
      return
    }

    await supabase.storage.from(bucket).remove([`${targetFolderPath}/.keep`])

    const targetNode = findTreeNode(browserState.nodes, targetFolderPath)
    if (targetNode) {
      await refreshFolderNode(targetNode)
    }

    setScoreState({
      status: 'success',
      message: `Uploaded ${file.name} to ${targetFolderPath}`,
    })
    setUploadTargetFolderPath('')
  }

  const handleDeleteFolder = async (node) => {
    const confirmed = window.confirm(`Delete folder ${node.path} and all its contents?`)

    if (!confirmed) {
      return
    }

    setDeletingFolderPath(node.path)
    setScoreState({
      status: 'loading',
      message: `Deleting folder ${node.path}...`,
    })

    try {
      const objectPaths = await listFolderObjectPaths(node.path)

      if (objectPaths.length) {
        const { error } = await supabase.storage.from(bucket).remove(objectPaths)

        if (error) {
          throw error
        }
      }

      await refreshNodeParent(node.path)
      setScoreState({
        status: 'success',
        message: `Deleted folder ${node.path}`,
      })
    } catch (error) {
      setScoreState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete the folder.',
      })
    } finally {
      setDeletingFolderPath('')
    }
  }

  const handleStartRenameFolder = (node) => {
    setRenameTargetPath(node.path)
    setRenameName(getBaseName(node.path))
  }

  const handleStartRenameFile = (file) => {
    setRenameTargetPath(file.path)
    setRenameName(file.name)
  }

  const handleCancelRename = () => {
    if (renamingPath) {
      return
    }

    setRenameTargetPath('')
    setRenameName('')
  }

  const handleRenameFolder = async (node) => {
    const currentName = getBaseName(node.path)
    const normalizedName = renameName.trim().replace(/^\/+|\/+$/g, '')

    if (!normalizedName || normalizedName === currentName) {
      handleCancelRename()
      return
    }

    const parentPath = node.path.split('/').slice(0, -1).join('/')
    const targetPath = parentPath ? `${parentPath}/${normalizedName}` : normalizedName

    setRenamingPath(node.path)
    setScoreState({
      status: 'loading',
      message: `Renaming folder ${node.path} to ${targetPath}...`,
    })

    try {
      await moveFolderObjects(node.path, targetPath)
      await refreshNodeParent(node.path)
      setScoreState({
        status: 'success',
        message: `Renamed folder to ${targetPath}`,
      })
    } catch (error) {
      setScoreState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to rename the folder.',
      })
    } finally {
      setRenamingPath('')
      setRenameTargetPath('')
      setRenameName('')
    }
  }

  const handleDeleteFile = async (file) => {
    const confirmed = window.confirm(`Delete file ${file.path}?`)

    if (!confirmed) {
      return
    }

    setDeletingFilePath(file.path)
    setScoreState({
      status: 'loading',
      message: `Deleting file ${file.path}...`,
    })

    try {
      const { error } = await supabase.storage.from(bucket).remove([file.path])

      if (error) {
        throw error
      }

      const parentNode = findTreeNode(browserState.nodes, file.parentPath)
      if (parentNode) {
        await refreshFolderNode(parentNode)
      }

      setScoreState({
        status: 'success',
        message: `Deleted file ${file.path}`,
      })
    } catch (error) {
      setScoreState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete the file.',
      })
    } finally {
      setDeletingFilePath('')
    }
  }

  const handleRenameFile = async (file) => {
    const normalizedName = renameName.trim().replace(/^\/+|\/+$/g, '')

    if (!normalizedName || normalizedName === file.name) {
      handleCancelRename()
      return
    }

    const targetPath = `${file.parentPath}/${normalizedName}`

    setRenamingPath(file.path)
    setScoreState({
      status: 'loading',
      message: `Renaming file ${file.path} to ${targetPath}...`,
    })

    try {
      const { error } = await supabase.storage.from(bucket).move(file.path, targetPath)

      if (error) {
        throw error
      }

      const parentNode = findTreeNode(browserState.nodes, file.parentPath)
      if (parentNode) {
        await refreshFolderNode(parentNode)
      }

      setScoreState({
        status: 'success',
        message: `Renamed file to ${targetPath}`,
      })
    } catch (error) {
      setScoreState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to rename the file.',
      })
    } finally {
      setRenamingPath('')
      setRenameTargetPath('')
      setRenameName('')
    }
  }

  if (view === 'editor') {
    return (
      <VideoEditor
        initialVideoInput={selectedVideoInput}
        onBack={() => {
          setOpeningFilePath('')
          setView('browser')
        }}
      />
    )
  }

  if (view === 'svg' && selectedSvgFile) {
    return (
      <SvgViewer
        file={selectedSvgFile}
        onBack={() => {
          setOpeningFilePath('')
          setView('browser')
        }}
      />
    )
  }

  return (
    <main className="app-shell">
      <section className="panel browser-panel">
        <input
          id="folder-upload-input"
          className="visually-hidden"
          type="file"
          onChange={handleUploadFile}
        />
        <div className="browser-header">
          <div>
            <p className="eyebrow">Bucket Browser</p>
            <h1>Supabase Exercises</h1>
            <p className="browser-subtitle">{bucket ? `Bucket: ${bucket}` : 'No bucket configured'}</p>
          </div>
        </div>

        <div className="browser-log-area" aria-live="polite">
          {scoreState.message ? (
            <p
              className={`browser-status ${
                scoreState.status === 'error'
                  ? 'export-status-error'
                  : scoreState.status === 'success'
                    ? 'export-status-success'
                    : ''
              }`}
            >
              {scoreState.message}
            </p>
          ) : browserState.status === 'loading' ? (
            <p className="browser-status">Loading exercises from Supabase storage...</p>
          ) : browserState.status === 'error' ? (
            <p className="browser-status export-status-error">{browserState.message}</p>
          ) : (
            <p className="browser-status browser-status-placeholder"> </p>
          )}
        </div>
        {browserState.status === 'ready' ? (
          <div className="browser-tree">
            <div className="browser-tree-header">
              <span>Folder</span>
            </div>
            {browserState.nodes.length ? (
              <ul className="tree-list">
                {browserState.nodes.map((node) => (
                  <BrowserTreeNode
                    key={node.path}
                    node={node}
                    onToggle={handleToggleNode}
                    onOpenFile={handleOpenFile}
                    onStartCreateFolder={handleStartCreateFolder}
                    onStartAddFile={handleStartAddFile}
                    onStartUpdateMedia={handleStartUpdateMedia}
                    onStartRenameFolder={handleStartRenameFolder}
                    onDeleteFolder={handleDeleteFolder}
                    updateMediaState={updateMediaState}
                    onCloseUpdateMedia={handleCloseUpdateMedia}
                    onToggleUpdateMediaOption={handleToggleUpdateMediaOption}
                    onSubmitUpdateMedia={handleSubmitUpdateMedia}
                    onCancelCreateFolder={handleCancelCreateFolder}
                    onChangeCreateFolderName={setCreateFolderName}
                    onSubmitCreateFolder={handleCreateFolder}
                    onCancelRename={handleCancelRename}
                    onChangeRenameName={setRenameName}
                    onSubmitRenameFolder={handleRenameFolder}
                    onStartRenameFile={handleStartRenameFile}
                    onRenameFile={handleRenameFile}
                    onDeleteFile={handleDeleteFile}
                    createFolderParentPath={createFolderParentPath}
                    createFolderName={createFolderName}
                    creatingFolderPath={creatingFolderPath}
                    renameTargetPath={renameTargetPath}
                    renameName={renameName}
                    deletingFolderPath={deletingFolderPath}
                    deletingFilePath={deletingFilePath}
                    renamingPath={renamingPath}
                    openingFilePath={openingFilePath}
                    museScoreLogPath={museScoreLogPath}
                    museScoreLogs={museScoreLogs}
                    updateMediaLogPath={updateMediaLogPath}
                    updateMediaLogs={updateMediaLogs}
                  />
                ))}
              </ul>
            ) : (
              <p className="browser-status">{browserState.message}</p>
            )}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App

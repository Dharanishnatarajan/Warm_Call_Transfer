"use client"

import { useState, useEffect, useRef } from "react"
import { Room, RoomEvent, Track, createLocalAudioTrack, ParticipantEvent } from "livekit-client"

import type {
  Participant,
  LocalAudioTrack,
  RemoteTrack,
  RemoteAudioTrack,
  TrackPublication,
  AudioCaptureOptions,
} from "livekit-client"

import { Phone, PhoneOff, Users, Mic, MicOff, Volume2, VolumeX, Loader2 } from "lucide-react"

import "../styles/warm-transfer.css"

// Types
interface CallSession {
  call_id: string
  room_name: string
  caller_token: string
  agent_a_token: string
  livekit_url: string
  status: string
}

interface TransferSession {
  transfer_id: string
  agentA_transfer_token: string
  agentB_token: string
  caller_token: string
  transfer_room: string
  livekit_url: string
  summary: string
  agent_script: string
  status: string
}

interface CallerInfo {
  name: string
  phone: string
  issue: string
}

type UserRole = "caller" | "agent_a" | "agent_b"

const API_BASE = "http://localhost:8000"

export default function WarmTransferPage() {
  // State Management
  const [userRole, setUserRole] = useState<UserRole>("caller")
  const [userName, setUserName] = useState("")
  const [roomNameToJoin, setRoomNameToJoin] = useState("") // New state for joining rooms
  const [activeTransfers, setActiveTransfers] = useState<any[]>([]) // New state for active transfers
  const [latestCall, setLatestCall] = useState<any>(null) // New state for latest call
  const [callerInfo, setCallerInfo] = useState<CallerInfo>({
    name: "",
    phone: "",
    issue: "",
  })

  // Room and connection states
  const [room, setRoom] = useState<Room | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [currentCallSession, setCurrentCallSession] = useState<CallSession | null>(null)
  const [currentTransfer, setCurrentTransfer] = useState<TransferSession | null>(null)

  // Audio states
  const [isMuted, setIsMuted] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [localAudioTrack, setLocalAudioTrack] = useState<LocalAudioTrack | null>(null)

  // Transfer and transcript states
  const [transcript, setTranscript] = useState("")
  const [isTransferring, setIsTransferring] = useState(false)
  const [transferStep, setTransferStep] = useState<"idle" | "briefing" | "completing" | "completed">("idle")
  const [callSummary, setCallSummary] = useState("")
  const [agentScript, setAgentScript] = useState("")

  // UI states
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [agentBName, setAgentBName] = useState("agent_b")
  const [error, setError] = useState("")
  const [logs, setLogs] = useState<string[]>([])

  // Refs
  const roomRef = useRef<Room | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  // ... existing code for all the functions (addLog, useEffect, setupRoomEvents, etc.) ...

  // Utility function to add logs
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev.slice(-9), `[${timestamp}] ${message}`])
    console.log(`[${timestamp}] ${message}`)
  }

  // Initialize audio track
  useEffect(() => {
    const initAudio = async () => {
      try {
        const audioTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as AudioCaptureOptions)
        setLocalAudioTrack(audioTrack)
        addLog("Local audio track initialized")
      } catch (error) {
        console.error("Failed to initialize audio:", error)
        addLog("Failed to initialize audio")
      }
    }

    initAudio()

    return () => {
      if (localAudioTrack) {
        localAudioTrack.stop()
      }
    }
  }, [])

  // Room event handlers
  const setupRoomEvents = (room: Room) => {
    room.on(RoomEvent.Connected, () => {
      addLog(`Connected to room: ${room.name}`)
      setIsConnected(true)
      setIsConnecting(false)
      setParticipants(Array.from(room.remoteParticipants.values()))
    })

    room.on(RoomEvent.Disconnected, () => {
      addLog("Disconnected from room")
      setIsConnected(false)
      setParticipants([])
    })

    room.on(RoomEvent.ParticipantConnected, (participant: Participant) => {
      addLog(`Participant connected: ${participant.identity}`)
      setParticipants((prev) => [...prev, participant])

      // Subscribe to participant's tracks
      participant.on(ParticipantEvent.TrackSubscribed, (track: RemoteTrack, publication: TrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          const audioElement = document.createElement("audio")
          audioElement.autoplay = true
          audioElement.controls = false
          ;(track as RemoteAudioTrack).attach(audioElement)
          document.body.appendChild(audioElement)
          addLog(`Subscribed to audio track from ${participant.identity}`)
        }
      })
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: Participant) => {
      addLog(`Participant disconnected: ${participant.identity}`)
      setParticipants((prev) => prev.filter((p) => p.identity !== participant.identity))
    })

    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: Participant) => {
      try {
        const message = new TextDecoder().decode(payload)
        const data = JSON.parse(message)

        if (data.type === "transcript_update") {
          setTranscript((prev) => prev + " " + data.text)
          addLog(`Transcript update from ${participant?.identity || "unknown"}`)
        }
      } catch (error) {
        console.error("Error processing data message:", error)
      }
    })

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: TrackPublication, participant: Participant) => {
        if (track.kind === Track.Kind.Audio) {
          const audioElement = document.createElement("audio")
          audioElement.autoplay = true
          audioElement.controls = false
          ;(track as RemoteAudioTrack).attach(audioElement)
          document.body.appendChild(audioElement)
          addLog(`Audio track subscribed from ${participant.identity}`)
        }
      },
    )
  }

  // Fetch latest call (for Agent A)
  const fetchLatestCall = async () => {
    try {
      const response = await fetch(`${API_BASE}/calls/latest`)
      if (!response.ok) {
        if (response.status === 404) {
          setLatestCall(null)
          return
        }
        throw new Error("Failed to fetch latest call")
      }
      
      const data = await response.json()
      setLatestCall(data)
      addLog(`Found latest call: ${data.caller_name} in room ${data.room_name}`)
    } catch (error) {
      console.error("Failed to fetch latest call:", error)
      setLatestCall(null)
    }
  }

  // Auto-join latest call (for Agent A)
  const autoJoinLatestCall = async () => {
    if (!latestCall || !userName.trim()) {
      setError("No call available to join or name not provided")
      return
    }

    setIsConnecting(true)
    setError("")

    try {
      // Get token for joining latest call room
      const response = await fetch(`${API_BASE}/token?identity=agent_a_${userName}&room=${latestCall.room_name}`)
      
      if (!response.ok) throw new Error("Failed to get join token")

      const tokenData = await response.json()
      
      // Create call session for joined room
      const callSession: CallSession = {
        call_id: latestCall.call_id,
        room_name: latestCall.room_name,
        caller_token: "",
        agent_a_token: tokenData.token,
        livekit_url: tokenData.url,
        status: "joined"
      }
      setCurrentCallSession(callSession)

      // Connect to LiveKit room
      const newRoom = new Room()
      setupRoomEvents(newRoom)

      await newRoom.connect(tokenData.url, tokenData.token)

      // Publish local audio track
      if (localAudioTrack) {
        await newRoom.localParticipant.publishTrack(localAudioTrack)
        addLog("Local audio track published")
      }

      setRoom(newRoom)
      roomRef.current = newRoom
      addLog(`Auto-joined call with ${latestCall.caller_name}`)
    } catch (error) {
      console.error("Failed to auto-join call:", error)
      setError(error instanceof Error ? error.message : "Failed to join latest call")
      setIsConnecting(false)
    }
  }

  // Poll for latest call when Agent A role is selected
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (userRole === "agent_a" && !isConnected) {
      fetchLatestCall()
      interval = setInterval(fetchLatestCall, 3000) // Poll every 3 seconds
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [userRole, isConnected])

  // Fetch active transfers (for Agent B)
  const fetchActiveTransfers = async () => {
    try {
      const response = await fetch(`${API_BASE}/transfers/active`)
      if (!response.ok) throw new Error("Failed to fetch active transfers")
      
      const data = await response.json()
      setActiveTransfers(data.active_transfers || [])
      addLog(`Found ${data.active_transfers?.length || 0} active transfers`)
    } catch (error) {
      console.error("Failed to fetch active transfers:", error)
      setError("Failed to fetch active transfers")
    }
  }

  // Join active transfer (for Agent B)
  const joinActiveTransfer = async (transferId: string) => {
    if (!userName.trim()) {
      setError("Please enter your name before joining transfer")
      return
    }

    try {
      // Get transfer details
      const transferResponse = await fetch(`${API_BASE}/transfer/${transferId}`)
      if (!transferResponse.ok) throw new Error("Failed to get transfer details")
      
      const transferData = await transferResponse.json()
      setCurrentTransfer(transferData)
      
      // Connect to transfer room as Agent B
      const newRoom = new Room()
      setupRoomEvents(newRoom)
      
      // Generate token for Agent B with proper identity
      const agentBIdentity = `agent_b_${userName}`
      const tokenResponse = await fetch(`${API_BASE}/token?identity=${agentBIdentity}&room=${transferData.transfer_room}`)
      if (!tokenResponse.ok) throw new Error("Failed to get Agent B token")
      
      const tokenData = await tokenResponse.json()
      
      await newRoom.connect(tokenData.url, tokenData.token)
      
      if (localAudioTrack) {
        await newRoom.localParticipant.publishTrack(localAudioTrack)
      }
      
      setRoom(newRoom)
      roomRef.current = newRoom
      setIsConnected(true)
      addLog(`Joined transfer session as Agent B (${agentBIdentity}): ${transferId}`)
      setShowTransferModal(true)
      
    } catch (error) {
      console.error("Failed to join transfer:", error)
      setError("Failed to join transfer session")
    }
  }

  // Poll for active transfers when Agent B role is selected
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (userRole === "agent_b" && !isConnected) {
      fetchActiveTransfers()
      interval = setInterval(fetchActiveTransfers, 5000) // Poll every 5 seconds
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [userRole, isConnected])

  // Check caller transfer status
  const checkCallerTransferStatus = async () => {
    if (!userName.trim()) return
    
    try {
      addLog(`🔍 Checking transfer status for caller: ${userName}`)
      const response = await fetch(`${API_BASE}/caller/${userName}/transfer-status`)
      if (!response.ok) {
        addLog(`No transfer status found for ${userName}`)
        return
      }
      
      const data = await response.json()
      addLog(`📊 Transfer status response: ${JSON.stringify(data)}`)
      
      if (data.transfer_complete) {
        addLog(`🔄 Transfer completed! Joining Agent B in room: ${data.final_room}`)
        await connectToFinalRoom(data.caller_token, data.final_room)
      }
    } catch (error) {
      console.error("Failed to check transfer status:", error)
      addLog(`❌ Error checking transfer status: ${error}`)
    }
  }

  // Poll for transfer completion when caller is connected
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (userRole === "caller" && isConnected && userName.trim()) {
      interval = setInterval(checkCallerTransferStatus, 3000) // Poll every 3 seconds
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [userRole, isConnected, userName])

  // Join an existing room (for Agent A)
  const joinExistingRoom = async () => {
    if (!userName.trim()) {
      setError("Please enter your name")
      return
    }

    if (!roomNameToJoin.trim()) {
      setError("Please enter room name to join")
      return
    }

    setIsConnecting(true)
    setError("")

    try {
      // Get token for joining existing room
      const response = await fetch(`${API_BASE}/token?identity=${userRole}_${userName}&room=${roomNameToJoin}`)
      
      if (!response.ok) throw new Error("Failed to get join token")

      const tokenData = await response.json()
      
      // Create mock call session for joined room
      const callSession: CallSession = {
        call_id: `joined_${Date.now()}`,
        room_name: roomNameToJoin,
        caller_token: "",
        agent_a_token: tokenData.token,
        livekit_url: tokenData.url,
        status: "joined"
      }
      setCurrentCallSession(callSession)

      // Connect to LiveKit room
      const newRoom = new Room()
      setupRoomEvents(newRoom)

      await newRoom.connect(tokenData.url, tokenData.token)

      // Publish local audio track
      if (localAudioTrack) {
        await newRoom.localParticipant.publishTrack(localAudioTrack)
        addLog("Local audio track published")
      }

      setRoom(newRoom)
      roomRef.current = newRoom
      addLog(`Joined room ${roomNameToJoin} as ${userRole}`)
    } catch (error) {
      console.error("Failed to join room:", error)
      setError(error instanceof Error ? error.message : "Failed to join room")
      setIsConnecting(false)
    }
  }

  // Start a new call
  const startCall = async () => {
    if (!userName.trim()) {
      setError("Please enter your name")
      return
    }

    setIsConnecting(true)
    setError("")

    try {
      const response = await fetch(`${API_BASE}/call/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller_name: userRole === "caller" ? userName : `${userRole}_${userName}`,
          caller_info: userRole === "caller" ? callerInfo : {},
        }),
      })

      if (!response.ok) throw new Error("Failed to start call")

      const callSession: CallSession = await response.json()
      setCurrentCallSession(callSession)

      // Connect to LiveKit room
      const newRoom = new Room()
      setupRoomEvents(newRoom)

      const token =
        userRole === "caller"
          ? callSession.caller_token
          : userRole === "agent_a"
            ? callSession.agent_a_token
            : callSession.caller_token

      await newRoom.connect(callSession.livekit_url, token)

      // Publish local audio track
      if (localAudioTrack) {
        await newRoom.localParticipant.publishTrack(localAudioTrack)
        addLog("Local audio track published")
      }

      setRoom(newRoom)
      roomRef.current = newRoom
      addLog(`Call started as ${userRole}`)
      
      // Display room name for sharing
      if (userRole === "caller") {
        addLog(`🔗 ROOM NAME: ${callSession.room_name}`)
        addLog(`📋 Share this room name with Agent A to join the same call`)
      }
    } catch (error) {
      console.error("Failed to start call:", error)
      setError(error instanceof Error ? error.message : "Failed to start call")
      setIsConnecting(false)
    }
  }

  // Generate call summary
  const generateSummary = async () => {
    if (!transcript.trim()) {
      setError("No transcript available for summary")
      return
    }

    try {
      const response = await fetch(`${API_BASE}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          call_id: currentCallSession?.call_id,
          caller_info: callerInfo,
        }),
      })

      if (!response.ok) throw new Error("Failed to generate summary")

      const data = await response.json()
      setCallSummary(data.summary)
      addLog("Call summary generated")
      return data.summary
    } catch (error) {
      console.error("Failed to generate summary:", error)
      setError("Failed to generate summary")
      return ""
    }
  }

  // Initiate warm transfer
  const initiateTransfer = async () => {
    if (!currentCallSession || !agentBName.trim()) {
      setError("Invalid transfer parameters")
      return
    }

    setIsTransferring(true)
    setTransferStep("briefing")
    setError("")

    try {
      // Generate summary first
      let summary = callSummary
      if (!summary && transcript.trim()) {
        summary = (await generateSummary()) || "No summary available"
      }

      // Create transfer room
      const transferRoomName = `transfer_${Date.now()}`
      
      // Get caller name: from userName if caller, from latestCall if agent_a, fallback to callerInfo
      const callerName = userRole === "caller" ? userName : 
                        (latestCall?.caller_name || callerInfo.name || "Unknown")
      
      const response = await fetch(
        `${API_BASE}/transfer?` +
          new URLSearchParams({
            original_room: currentCallSession.room_name,
            new_room: transferRoomName,
            agent_a: "agent_a",
            agent_b: agentBName,
            transcript,
            caller_name: callerName,
          }),
        { method: "POST" },
      )

      if (!response.ok) throw new Error("Failed to initiate transfer")

      const transferSession: TransferSession = await response.json()
      setCurrentTransfer(transferSession)
      setAgentScript(transferSession.agent_script)
      addLog("Transfer initiated, briefing phase started")

      // If user is Agent A, connect to briefing room
      if (userRole === "agent_a") {
        await connectToBriefingRoom(transferSession)
      }

      setShowTransferModal(true)
    } catch (error) {
      console.error("Transfer failed:", error)
      setError(error instanceof Error ? error.message : "Transfer failed")
      setIsTransferring(false)
      setTransferStep("idle")
    }
  }

  // Connect to briefing room (for Agent A)
  const connectToBriefingRoom = async (transferSession: TransferSession) => {
    try {
      const briefingRoom = new Room()
      setupRoomEvents(briefingRoom)

      await briefingRoom.connect(transferSession.livekit_url, transferSession.agentA_transfer_token)

      if (localAudioTrack) {
        await briefingRoom.localParticipant.publishTrack(localAudioTrack)
      }

      // Replace current room with briefing room
      if (room) {
        await room.disconnect()
      }

      setRoom(briefingRoom)
      roomRef.current = briefingRoom
      addLog("Connected to briefing room")
    } catch (error) {
      console.error("Failed to connect to briefing room:", error)
      setError("Failed to connect to briefing room")
    }
  }

  // Complete transfer
  const completeTransfer = async () => {
    if (!currentTransfer || !currentCallSession) {
      setError("No active transfer to complete")
      return
    }

    setTransferStep("completing")

    try {
      // Get caller name: from userName if caller, from latestCall if agent_a, fallback to callerInfo
      const callerName = userRole === "caller" ? userName : 
                        (latestCall?.caller_name || callerInfo.name || "Unknown")
      
      const response = await fetch(`${API_BASE}/transfer/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: currentTransfer.transfer_id,
          original_room: currentCallSession.room_name,
          caller_name: callerName,
          agent_b: agentBName,
        }),
      })

      if (!response.ok) throw new Error("Failed to complete transfer")

      const result = await response.json()
      setTransferStep("completed")
      addLog("Transfer completed successfully")

      // If caller, connect to final room with Agent B
      if (userRole === "caller") {
        await connectToFinalRoom(result.caller_token, result.final_room)
      }

      // If Agent A, disconnect after briefing
      if (userRole === "agent_a") {
        setTimeout(() => {
          disconnectCall()
          addLog("Agent A disconnected after transfer")
        }, 2000)
      }

      setShowTransferModal(false)
      setIsTransferring(false)
    } catch (error) {
      console.error("Failed to complete transfer:", error)
      setError("Failed to complete transfer")
      setTransferStep("briefing")
    }
  }

  // Connect to final room (for caller)
  const connectToFinalRoom = async (token: string, roomName: string) => {
    try {
      addLog(`Attempting to connect caller to final room: ${roomName}`)
      
      const finalRoom = new Room()
      setupRoomEvents(finalRoom)

      await finalRoom.connect(currentTransfer!.livekit_url, token)
      addLog(`Successfully connected to LiveKit server`)

      if (localAudioTrack) {
        await finalRoom.localParticipant.publishTrack(localAudioTrack)
        addLog(`Published caller audio track`)
      }

      // Replace current room
      if (room) {
        await room.disconnect()
        addLog(`Disconnected from previous room`)
      }

      setRoom(finalRoom)
      roomRef.current = finalRoom
      addLog(`✅ Caller successfully connected to final room with Agent B: ${roomName}`)
      addLog(`🎯 Transfer complete - caller is now with Agent B`)
    } catch (error) {
      console.error("Failed to connect to final room:", error)
      addLog(`❌ Failed to connect to final room: ${error}`)
      setError("Failed to connect to final room")
    }
  }

  // Join as Agent B
  const joinAsAgentB = async () => {
    if (!currentTransfer) {
      setError("No transfer session available")
      return
    }

    setIsConnecting(true)
    setError("")

    try {
      const newRoom = new Room()
      setupRoomEvents(newRoom)

      await newRoom.connect(currentTransfer.livekit_url, currentTransfer.agentB_token)

      if (localAudioTrack) {
        await newRoom.localParticipant.publishTrack(localAudioTrack)
      }

      setRoom(newRoom)
      roomRef.current = newRoom
      setUserRole("agent_b")
      addLog("Joined as Agent B for transfer briefing")
    } catch (error) {
      console.error("Failed to join as Agent B:", error)
      setError("Failed to join as Agent B")
      setIsConnecting(false)
    }
  }

  // Toggle mute
  const toggleMute = () => {
    if (localAudioTrack) {
      localAudioTrack.setEnabled(!isMuted)
      setIsMuted(!isMuted)
      addLog(`Audio ${isMuted ? "unmuted" : "muted"}`)
    }
  }

  // Toggle audio
  const toggleAudio = () => {
    setAudioEnabled(!audioEnabled)
    if (room) {
      const audioElements = document.querySelectorAll("audio")
      audioElements.forEach((audio) => {
        audio.volume = audioEnabled ? 0 : 1
      })
    }
    addLog(`Speaker ${audioEnabled ? "disabled" : "enabled"}`)
  }

  // Disconnect call
  const disconnectCall = async () => {
    if (room) {
      await room.disconnect()
      setRoom(null)
      roomRef.current = null
    }

    setIsConnected(false)
    setParticipants([])
    setCurrentCallSession(null)
    setCurrentTransfer(null)
    setTransferStep("idle")
    setIsTransferring(false)
    setShowTransferModal(false)
    setTranscript("")
    setCallSummary("")
    setAgentScript("")
    addLog("Disconnected from call")
  }

  // Add sample transcript (for testing)
  const addSampleTranscript = () => {
    const sampleText =
      "Customer called about billing issue with their account. They mentioned charges they don't recognize from last month. I explained the billing cycle and helped them identify the charges. They seem satisfied with the explanation but want to speak to a supervisor about a potential refund."
    setTranscript((prev) => prev + " " + sampleText)
    addLog("Sample transcript added")
  }

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect()
      }
      if (localAudioTrack) {
        localAudioTrack.stop()
      }
    }
  }, [])

  return (
    <div className="warm-transfer-container">
      <div className="warm-transfer-wrapper">
        {/* Header */}
        <div className="warm-transfer-header">
          <h1 className="warm-transfer-title">Warm Call Transfer System</h1>
          <p className="warm-transfer-subtitle">LiveKit + LLM powered intelligent call transfers</p>
        </div>

        <div className="warm-transfer-grid">
          {/* Connection Panel */}
          <div>
            <div className="connection-panel">
              <h2 className="connection-panel-title">Connection Setup</h2>

              {/* Role Selection */}
              <div className="form-group">
                <label className="form-label">Select Role</label>
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value as UserRole)}
                  className="form-input"
                  disabled={isConnected}
                >
                  <option value="caller">Caller</option>
                  <option value="agent_a">Agent A</option>
                  <option value="agent_b">Agent B</option>
                </select>
              </div>

              {/* Name Input */}
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your name"
                  className="form-input"
                  disabled={isConnected}
                />
              </div>

              {/* Caller Info (only for caller role) */}
              {userRole === "caller" && (
                <div className="caller-info-group">
                  <input
                    type="text"
                    value={callerInfo.name}
                    onChange={(e) => setCallerInfo((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Full Name"
                    className="form-input"
                    disabled={isConnected}
                  />
                  <input
                    type="tel"
                    value={callerInfo.phone}
                    onChange={(e) => setCallerInfo((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="Phone Number"
                    className="form-input"
                    disabled={isConnected}
                  />
                  <input
                    type="text"
                    value={callerInfo.issue}
                    onChange={(e) => setCallerInfo((prev) => ({ ...prev, issue: e.target.value }))}
                    placeholder="Issue/Reason for call"
                    className="form-input"
                    disabled={isConnected}
                  />
                </div>
              )}

              {/* Auto-Join Latest Call (for Agent A) */}
              {userRole === "agent_a" && !isConnected && latestCall && (
                <div className="form-group">
                  <label className="form-label">Available Call to Join</label>
                  <div className="latest-call-card">
                    <div className="call-info">
                      <div className="call-header">
                        <span className="call-caller">📞 {latestCall.caller_name}</span>
                        <span className="call-time">⏰ {new Date(latestCall.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="call-room">
                        Room: <span className="room-name">{latestCall.room_name}</span>
                      </div>
                    </div>
                    <button 
                      onClick={autoJoinLatestCall}
                      disabled={isConnecting || !userName.trim()}
                      className="btn-auto-join"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="animate-spin" style={{ width: "1rem", height: "1rem" }} />
                          Joining...
                        </>
                      ) : (
                        <>
                          <Users style={{ width: "1rem", height: "1rem" }} />
                          Auto-Join Call
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Active Transfers Section (for Agent B) */}
              {userRole === "agent_b" && !isConnected && activeTransfers.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Active Transfer Sessions</label>
                  <div className="active-transfers-list">
                    {activeTransfers.map((transfer) => (
                      <div key={transfer.transfer_id} className="transfer-item">
                        <div className="transfer-info">
                          <div className="transfer-header">
                            <span className="transfer-caller">📞 {transfer.caller_name}</span>
                            <span className="transfer-agent">👤 from {transfer.agent_a}</span>
                          </div>
                          <div className="transfer-summary">
                            {transfer.summary ? transfer.summary.substring(0, 100) + "..." : "No summary available"}
                          </div>
                          <div className="transfer-time">
                            ⏰ {new Date(transfer.created_at).toLocaleTimeString()}
                          </div>
                        </div>
                        <button 
                          onClick={() => joinActiveTransfer(transfer.transfer_id)}
                          className="btn-join-transfer"
                        >
                          Join Briefing
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Join Room Section (for Agent A and Agent B) */}
              {(userRole === "agent_a" || userRole === "agent_b") && (
                <div className="form-group">
                  <label className="form-label">Join Existing Room</label>
                  <input
                    type="text"
                    value={roomNameToJoin}
                    onChange={(e) => setRoomNameToJoin(e.target.value)}
                    placeholder="Enter room name (e.g., call_abc123)"
                    className="form-input"
                    disabled={isConnected}
                  />
                </div>
              )}

              {/* Connection Button */}
              {!isConnected ? (
                <div className="connection-buttons">
                  {userRole === "caller" && (
                    <button onClick={startCall} disabled={isConnecting || !userName.trim()} className="btn-primary">
                      {isConnecting ? (
                        <>
                          <Loader2 className="animate-spin" style={{ width: "1rem", height: "1rem" }} />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Phone style={{ width: "1rem", height: "1rem" }} />
                          Start Call
                        </>
                      )}
                    </button>
                  )}
                  
                  {(userRole === "agent_a" || userRole === "agent_b") && (
                    <>
                      <button 
                        onClick={joinExistingRoom} 
                        disabled={isConnecting || !userName.trim() || !roomNameToJoin.trim()} 
                        className="btn-secondary"
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="animate-spin" style={{ width: "1rem", height: "1rem" }} />
                            Joining...
                          </>
                        ) : (
                          <>
                            <Users style={{ width: "1rem", height: "1rem" }} />
                            Join Room
                          </>
                        )}
                      </button>
                      
                      <div className="separator-text">OR</div>
                      
                      <button onClick={startCall} disabled={isConnecting || !userName.trim()} className="btn-outline">
                        {isConnecting ? (
                          <>
                            <Loader2 className="animate-spin" style={{ width: "1rem", height: "1rem" }} />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <Phone style={{ width: "1rem", height: "1rem" }} />
                            Start New Call
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <button onClick={disconnectCall} className="btn-danger">
                  <PhoneOff style={{ width: "1rem", height: "1rem" }} />
                  End Call
                </button>
              )}

              {/* Error Display */}
              {error && (
                <div className="error-message">
                  <p className="error-text">{error}</p>
                </div>
              )}
            </div>

            {/* Call Controls */}
            {isConnected && (
              <div className="call-controls">
                <h3 className="call-controls-title">Call Controls</h3>

                <div className="control-buttons">
                  <button
                    onClick={toggleMute}
                    className={`control-btn ${isMuted ? "control-btn-muted" : "control-btn-normal"}`}
                  >
                    {isMuted ? (
                      <MicOff style={{ width: "1rem", height: "1rem" }} />
                    ) : (
                      <Mic style={{ width: "1rem", height: "1rem" }} />
                    )}
                    {isMuted ? "Unmute" : "Mute"}
                  </button>

                  <button
                    onClick={toggleAudio}
                    className={`control-btn ${!audioEnabled ? "control-btn-muted" : "control-btn-normal"}`}
                  >
                    {audioEnabled ? (
                      <Volume2 style={{ width: "1rem", height: "1rem" }} />
                    ) : (
                      <VolumeX style={{ width: "1rem", height: "1rem" }} />
                    )}
                    Speaker
                  </button>
                </div>

                {/* Participants */}
                <div className="participants-section">
                  <div className="participants-header">
                    <Users style={{ width: "1rem", height: "1rem" }} />
                    Participants ({participants.length + 1})
                  </div>
                  <div className="participants-list">
                    <div className="participant-item participant-you">You ({userRole})</div>
                    {participants.map((participant) => (
                      <div key={participant.identity} className="participant-item participant-other">
                        {participant.identity}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Transfer Controls (for Agent A) */}
                {userRole === "agent_a" && !isTransferring && (
                  <div className="transfer-controls">
                    <input
                      type="text"
                      value={agentBName}
                      onChange={(e) => setAgentBName(e.target.value)}
                      placeholder="Agent B name"
                      className="form-input"
                    />
                    <button onClick={initiateTransfer} className="btn-secondary" style={{ width: "100%" }}>
                      Initiate Warm Transfer
                    </button>
                  </div>
                )}

                {/* Join as Agent B button */}
                {userRole === "agent_b" && currentTransfer && !isConnected && (
                  <button onClick={joinAsAgentB} className="btn-purple">
                    Join Transfer Session
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Main Content Area */}
          <div className="main-content">
            {/* Transcript Section */}
            <div className="transcript-section">
              <div className="transcript-header">
                <h3 className="transcript-title">Call Transcript</h3>
                <div className="transcript-buttons">
                  <button onClick={addSampleTranscript} className="btn-small">
                    Add Sample
                  </button>
                  <button onClick={() => setTranscript("")} className="btn-small">
                    Clear
                  </button>
                </div>
              </div>

              <div className="transcript-display">
                {transcript ? (
                  <p className="transcript-text">{transcript}</p>
                ) : (
                  <p className="transcript-placeholder">Call transcript will appear here...</p>
                )}
              </div>

              <div>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Add to transcript manually..."
                  className="transcript-input"
                  rows={3}
                />
              </div>

              {/* Generate Summary Button */}
              <div style={{ marginTop: "1rem" }}>
                <button onClick={generateSummary} disabled={!transcript.trim()} className="btn-secondary">
                  Generate Summary
                </button>
              </div>
            </div>

            {/* Call Summary */}
            {callSummary && (
              <div className="summary-section">
                <h3 className="summary-title">Call Summary</h3>
                <div className="summary-content">
                  <p className="summary-text">{callSummary}</p>
                </div>
              </div>
            )}

            {/* Activity Logs */}
            <div className="logs-section">
              <h3 className="logs-title">Activity Logs</h3>
              <div className="logs-display">
                {logs.length > 0 ? (
                  logs.map((log, index) => (
                    <div key={index} className="logs-entry">
                      {log}
                    </div>
                  ))
                ) : (
                  <div className="logs-placeholder">No activity logs yet...</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Transfer Modal */}
        {showTransferModal && currentTransfer && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <div className="modal-title-row">
                  <h2 className="modal-title">Warm Transfer in Progress</h2>
                  <div className="modal-status">
                    <div
                      className={`status-indicator ${
                        transferStep === "briefing"
                          ? "status-briefing"
                          : transferStep === "completing"
                            ? "status-completing"
                            : transferStep === "completed"
                              ? "status-completed"
                              : "status-idle"
                      }`}
                    ></div>
                    <span className="status-text">{transferStep}</span>
                  </div>
                </div>

                {/* Transfer Steps Progress */}
                <div className="progress-container">
                  <div className="progress-labels">
                    <span className={transferStep === "briefing" ? "progress-label-active" : "progress-label-inactive"}>
                      Briefing Agent B
                    </span>
                    <span
                      className={transferStep === "completing" ? "progress-label-active" : "progress-label-inactive"}
                    >
                      Completing Transfer
                    </span>
                    <span
                      className={transferStep === "completed" ? "progress-label-completed" : "progress-label-inactive"}
                    >
                      Transfer Complete
                    </span>
                  </div>
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width:
                          transferStep === "briefing"
                            ? "33%"
                            : transferStep === "completing"
                              ? "66%"
                              : transferStep === "completed"
                                ? "100%"
                                : "0%",
                      }}
                    ></div>
                  </div>
                </div>

                {/* Agent Script */}
                {agentScript && userRole === "agent_a" && (
                  <div className="agent-script-section">
                    <h3 className="agent-script-title">Script for Agent B Briefing</h3>
                    <div className="agent-script-content">
                      <p className="agent-script-text">{agentScript}</p>
                    </div>
                    <p className="agent-script-note">💡 Read this script aloud to Agent B to provide call context</p>
                  </div>
                )}

                {/* Transfer Summary */}
                {currentTransfer.summary && (
                  <div className="summary-section">
                    <h3 className="summary-title">Call Summary for Agent B</h3>
                    <div className="summary-content">
                      <p className="summary-text">{currentTransfer.summary}</p>
                    </div>
                  </div>
                )}

                {/* Transfer Room Info */}
                <div className="transfer-details-section">
                  <h3 className="transfer-details-title">Transfer Session Details</h3>
                  <div className="transfer-details-content">
                    <div className="transfer-detail-row">
                      <span className="transfer-detail-label">Transfer ID:</span>
                      <span className="transfer-detail-value">{currentTransfer.transfer_id}</span>
                    </div>
                    <div className="transfer-detail-row">
                      <span className="transfer-detail-label">Transfer Room:</span>
                      <span className="transfer-detail-value">{currentTransfer.transfer_room}</span>
                    </div>
                    <div className="transfer-detail-row">
                      <span className="transfer-detail-label">Agent A:</span>
                      <span className="transfer-detail-value-normal">agent_a</span>
                    </div>
                    <div className="transfer-detail-row">
                      <span className="transfer-detail-label">Agent B:</span>
                      <span className="transfer-detail-value-normal">{agentBName}</span>
                    </div>
                  </div>
                </div>

                <div className="modal-actions">
                  {userRole === "agent_a" && transferStep === "briefing" && (
                    <button onClick={completeTransfer} className="btn-complete-transfer">
                      Complete Transfer
                    </button>
                  )}

                  {transferStep === "completed" && (
                    <div className="transfer-completed-message">✓ Transfer Completed Successfully</div>
                  )}

                  <button onClick={() => setShowTransferModal(false)} className="btn-modal-close">
                    {transferStep === "completed" ? "Close" : "Minimize"}
                  </button>
                </div>

                {/* Instructions based on role */}
                <div className="instructions-section">
                  <h4 className="instructions-title">Instructions:</h4>
                  {userRole === "agent_a" && transferStep === "briefing" && (
                    <div className="instructions-list">
                      <p>1. Wait for Agent B to join the transfer room</p>
                      <p>2. Read the provided script to brief Agent B about the call</p>
                      <p>3. Answer any questions Agent B might have</p>
                      <p>4. Click Complete Transfer when ready to transfer the caller</p>
                    </div>
                  )}
                  {userRole === "agent_b" && (
                    <div className="instructions-list">
                      <p>1. Listen to Agent As briefing about the callers situation</p>
                      <p>2. Ask any clarifying questions you need</p>
                      <p>3. Prepare to take over the call once transfer is complete</p>
                      <p>4. The caller will be transferred to you shortly</p>
                    </div>
                  )}
                  {userRole === "caller" && (
                    <div className="instructions-list">
                      <p>1. Please hold while Agent A briefs the specialist</p>
                      <p>2. You will be connected to Agent B shortly</p>
                      <p>3. Agent B will have full context of your call</p>
                      <p>4. No need to repeat your issue</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status Bar */}
        <div className="status-bar">
          <div className="status-bar-content">
            <div className="status-bar-left">
              <div className="status-connection">
                <div
                  className={`connection-indicator ${isConnected ? "connection-connected" : "connection-disconnected"}`}
                ></div>
                <span className="connection-text">{isConnected ? "Connected" : "Disconnected"}</span>
              </div>

              {currentCallSession && (
                <div className="status-room">
                  Room: <span className="status-room-name">{currentCallSession.room_name}</span>
                </div>
              )}

              {isTransferring && (
                <div className="status-transfer">
                  <div className="transfer-indicator"></div>
                  <span className="transfer-text">Transfer in Progress</span>
                </div>
              )}
            </div>

            <div className="status-bar-right">
              <span>
                Role: <span className="status-role">{userRole.replace("_", " ")}</span>
              </span>
              <span>
                Participants: <span className="status-participants">{participants.length + (isConnected ? 1 : 0)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Help Section */}
        <div className="help-section">
          <h3 className="help-title">How to Use</h3>
          <div className="help-grid">
            <div>
              <h4 className="help-step-title">1. Start a Call</h4>
              <ul className="help-step-list">
                <li>• Select your role (Caller/Agent A/Agent B)</li>
                <li>• Enter your name and details</li>
                <li>• Click Start Call to connect</li>
              </ul>
            </div>
            <div>
              <h4 className="help-step-title">2. During the Call</h4>
              <ul className="help-step-list">
                <li>• Use transcript area to track conversation</li>
                <li>• Generate AI summaries as needed</li>
                <li>• Control audio with mute/speaker buttons</li>
              </ul>
            </div>
            <div>
              <h4 className="help-step-title">3. Warm Transfer</h4>
              <ul className="help-step-list">
                <li>• Agent A initiates transfer to Agent B</li>
                <li>• AI generates briefing script</li>
                <li>• Seamless handoff with full context</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

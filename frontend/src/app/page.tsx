"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Room as LKRoomClass, 
  RemoteParticipant as LKParticipantClass, 
  setLogLevel,
  LogLevel,
  createLocalTracks,
  RemoteAudioTrack,
} from "livekit-client";
import axios from "axios";
import "./page.css";

type LKRoom = InstanceType<typeof LKRoomClass>;
type LKParticipant = InstanceType<typeof LKParticipantClass>;

setLogLevel(LogLevel.debug);

export default function Home() {
  const [identity, setIdentity] = useState("Alice");
  const [roomName, setRoomName] = useState("room1");
  const [roomInstance, setRoomInstance] = useState<LKRoom | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [transferRoomName, setTransferRoomName] = useState("transfer-room");
  const [agentBIdentity, setAgentBIdentity] = useState("AgentB");
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    return () => {
      if (roomInstance) roomInstance.disconnect();
    };
  }, [roomInstance]);

  const joinRoom = async () => {
    try {
      const res = await axios.get<{ token: string; url: string }>(
        "http://127.0.0.1:8000/token",
        { params: { identity, room: roomName } }
      );

      const { token, url } = res.data;
      const newRoom = new LKRoomClass();

      const tracks = await createLocalTracks({ audio: true, video: false });
      await newRoom.connect(url, token, { autoSubscribe: true });

      if (tracks.length > 0) {
        await newRoom.localParticipant.publishTrack(tracks[0]);
      }

      setRoomInstance(newRoom);
      setIsConnected(true);

      newRoom.on("participantConnected", (participant: LKParticipant) => {
        console.log("Participant connected:", participant.identity);
        setParticipants(prev => {
          // Avoid duplicates and exclude local identity
          if (participant.identity !== identity && !prev.includes(participant.identity)) {
            return [...prev, participant.identity];
          }
          return prev;
        });
      });

      newRoom.on("participantDisconnected", (participant: LKParticipant) => {
        console.log("Participant disconnected:", participant.identity);
        setParticipants(prev => prev.filter(id => id !== participant.identity));
      });

      newRoom.on("trackSubscribed", (track: { attach: (arg0: HTMLAudioElement) => void; }) => {
        if (track instanceof RemoteAudioTrack && audioRef.current) {
          track.attach(audioRef.current);
        }
      });

      setTimeout(() => {
        if (newRoom.participants) {
          const currentParticipants = Array.from(newRoom.participants.values())
            .map((p: LKParticipant) => p.identity)
            .filter((p) => p !== identity);  // Exclude local identity here
          setParticipants(currentParticipants);
        }
      }, 1000);
      
    } catch (error) {
      console.error("Failed to join room:", error);
      alert("Failed to join room");
    }
  };

  const leaveRoom = () => {
    if (roomInstance) {
      roomInstance.disconnect();
      setRoomInstance(null);
      setIsConnected(false);
      setParticipants([]);
      setSummary("");
    }
  };

  const summarizeCall = async () => {
    if (!transcript) {
      alert("Enter a transcript first");
      return;
    }
    try {
      const res = await axios.post<{ summary: string }>(
        "http://127.0.0.1:8000/summarize",
        { transcript }
      );
      setSummary(res.data.summary);
    } catch (error) {
      console.error(error);
      alert("Error generating summary.");
    }
  };

  const transferCall = async () => {
    if (!roomInstance || !transcript) {
      alert("Join a room and enter transcript first");
      return;
    }
    
    try {
      const res = await axios.post<{
        agentB_token: string;
        livekit_url: string;
        summary: string;
      }>("http://127.0.0.1:8000/transfer", null,{
        params: {
          original_room: roomName,
          new_room: transferRoomName,
          agent_a: identity,
          agent_b: agentBIdentity,
          transcript,
        },
      });

      alert(`Transfer initiated! Summary for Agent B: ${res.data.summary}`);
      console.log("Agent B token:", res.data.agentB_token);
      leaveRoom();
    } catch (error) {
      console.error(error);
      alert("Transfer failed");
    }
  };

  return (
    <div className="container">
      <h1>Warm Call Transfer - LiveKit</h1>

      <div className="row">
        <input
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          placeholder="Your name"
          disabled={isConnected}
        />
        <input
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          placeholder="Room name"
          disabled={isConnected}
        />
        {!isConnected ? (
          <button onClick={joinRoom}>Join Room</button>
        ) : (
          <button onClick={leaveRoom}>Leave Room</button>
        )}
      </div>

      {isConnected && (
        <>
          <div>
            <strong>Participants in {roomName}:</strong>
            <ul>
              <li key={identity}>{identity} (You)</li>
              {participants.length === 0 && (
                <li style={{ color: "#bbb", fontStyle: "italic" }}>
                  No other participants
                </li>
              )}
              {participants
                .filter((p) => p !== identity)
                .map((p) => (
                  <li key={p}>{p}</li>
                ))}
            </ul>
          </div>

          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Enter call transcript"
            rows={4}
            style={{ width: "100%" }}
          />

          <button onClick={summarizeCall}>Summarize Call</button>

          {summary && (
            <div>
              <strong>Call Summary:</strong>
              <p>{summary}</p>
            </div>
          )}

          <div className="row">
            <input
              value={transferRoomName}
              onChange={(e) => setTransferRoomName(e.target.value)}
              placeholder="Transfer room name"
            />
            <input
              value={agentBIdentity}
              onChange={(e) => setAgentBIdentity(e.target.value)}
              placeholder="Agent B identity"
            />
            <button onClick={transferCall}>Transfer Call to Agent B</button>
          </div>
        </>
      )}

      <audio ref={audioRef} autoPlay muted={false} style={{ display: "none" }} />
    </div>
  );
}

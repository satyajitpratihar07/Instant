export interface Session {
  id: string;
  avatarSeed: string;
  name: string;
  connectedRoomId: string | null;
  lastActive?: number;
  expiresAt?: number;
}

export interface Peer {
  id: string;
  name: string;
  avatarSeed: string;
  online: boolean;
}

export interface FileAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url?: string;
}


export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  file?: FileAttachment;
}

export interface RoomSyncPayload {
  roomId: string;
  messages: Message[];
  peer: Peer;
}

export interface PendingFile {
  file: File;
  previewUrl: string;
  base64Data: string;
  isImage: boolean;
}

export interface JoinRequest {
  id: string;
  name: string;
  avatarSeed: string;
  timestamp: number;
}

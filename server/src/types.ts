export interface Participant {
  address: string; // phone/email
  service: string;
  name?: string;
}

export interface ChatSummary {
  id: number;
  guid: string;
  identifier: string;
  displayName: string | null;
  service: string;
  isGroup: boolean;
  participants: Participant[];
  lastDate: number | null;
  lastText: string | null;
  lastFromMe: boolean;
  unread: number;
}

export interface Attachment {
  id: number;
  guid: string;
  filename: string | null;
  transferName: string | null;
  mimeType: string | null;
  uti: string | null;
  totalBytes: number;
  isImage: boolean;
  isVideo: boolean;
  isSticker: boolean;
}

export interface Reaction {
  type: ReactionName;
  fromMe: boolean;
  sender: string | null;
  senderName?: string;
  messageGuid: string;
  date: number | null;
}

export type ReactionName = 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question' | 'custom';

export interface Message {
  id: number;
  guid: string;
  chatId: number;
  text: string | null;
  sender: string | null; // null when from me
  senderName?: string;
  fromMe: boolean;
  date: number | null;
  dateRead: number | null;
  dateDelivered: number | null;
  dateEdited: number | null;
  isRead: boolean;
  isSent: boolean;
  isDelivered: boolean;
  error: number;
  service: string | null;
  itemType: number;
  groupActionType: number;
  groupTitle: string | null;
  balloonBundleId: string | null;
  threadOriginatorGuid: string | null;
  threadOriginatorPart: string | null;
  replyCount: number;
  attachments: Attachment[];
  reactions: Reaction[];
  /** Populated for reply messages so the UI can quote the original. */
  replyTo?: { guid: string; text: string | null; sender: string | null; fromMe: boolean } | null;
  isAudioMessage: boolean;
  expressiveSendStyleId: string | null;
}

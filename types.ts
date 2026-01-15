
export type PostType = 'tweet' | 'reply' | 'repost';

export interface XPost {
  id: string;
  full_text: string;
  created_at: string;
  type: PostType;
  reply_to_user_id?: string;
  reply_to_status_id?: string;
  favorite_count: number;
  retweet_count: number;
}

export interface ArchiveFilter {
  dateFrom: string;
  dateTo: string;
  keywords: string[];
  postTypes: PostType[];
}

export enum ProcessStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  AUDITING = 'AUDITING',
  PURGING = 'PURGING',
  COMPLETED = 'COMPLETED',
  PAUSED = 'PAUSED'
}

export interface AuditResult {
  reason: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  sentiment: string;
}

export interface PurgeProgress {
  total: number;
  completed: number;
  remaining: number;
  startTime: number;
  currentType: PostType | null;
  secondsToNext: number;
}

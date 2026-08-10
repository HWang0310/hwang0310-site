import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AppRole,
  ReportVisibility,
} from "../../shared/income-forecast/contracts";
import type { RuntimeConfig } from "./env";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type ProfileRow = {
  user_id: string;
  full_name: string;
  employee_no: string;
  phone: string;
  email: string;
  role: AppRole;
  is_active: boolean;
  uses_initial_password: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
};

export type AuditEventRow = {
  id: number;
  event_type: string;
  actor_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  success: boolean;
  metadata: Json;
  created_at: string;
};

type ReportRow = {
  report_date: string;
  title: string;
  release_id: string | null;
  storage_prefix: string | null;
  visibility: ReportVisibility;
  pinned: boolean;
  status: "staging" | "online" | "offline";
  size_bytes: number;
  file_count: number;
  published_at: string | null;
  cleaned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IncomeForecastDatabase = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Omit<ProfileRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ProfileRow, "user_id" | "created_at">>;
        Relationships: [];
      };
      audit_events: {
        Row: AuditEventRow;
        Insert: Omit<AuditEventRow, "id" | "created_at"> & {
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      reports: {
        Row: ReportRow;
        Insert: Omit<ReportRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ReportRow, "report_date" | "created_at">>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      app_role: AppRole;
    };
    CompositeTypes: Record<never, never>;
  };
};

export type IncomeForecastSupabaseClient = SupabaseClient<IncomeForecastDatabase>;

const serverAuthOptions = {
  autoRefreshToken: false,
  detectSessionInUrl: false,
  persistSession: false,
} as const;

export function createPublicSupabaseClient(
  config: RuntimeConfig,
): IncomeForecastSupabaseClient {
  return createClient<IncomeForecastDatabase>(
    config.supabaseUrl,
    config.supabasePublishableKey,
    { auth: serverAuthOptions },
  );
}

export function createServiceRoleSupabaseClient(
  config: RuntimeConfig,
): IncomeForecastSupabaseClient {
  return createClient<IncomeForecastDatabase>(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    { auth: serverAuthOptions },
  );
}

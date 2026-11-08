/**
 * The slice of the database the browser touches in M6, hand-written to match supabase/migrations/…000400_personal_data.sql.
 * The client may only READ these two tables (and later update a few columns): the trigger creates both rows, and there is no
 * insert grant, so Insert is `never` here and a stray insert fails to compile.
 */
// `type`, not `interface`: the SDK requires each row to be assignable to Record<string, unknown>, which an interface is not.
export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_data_url: string | null;
  time_zone: string;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserSettingsRow = {
  user_id: string;
  /** numeric columns arrive from PostgREST as JSON numbers */
  daily_target_hours: number;
  weekly_target_hours: number;
  /** a Postgres `time` arrives as "HH:MM:SS" */
  study_start_time: string;
  study_end_time: string;
  pomodoro_focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number;
  theme: 'dark' | 'light' | 'system';
  created_at: string;
  updated_at: string;
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: never;
        Update: Partial<Pick<ProfileRow, 'display_name' | 'avatar_data_url' | 'time_zone' | 'onboarding_completed_at'>>;
        Relationships: [];
      };
      user_settings: {
        Row: UserSettingsRow;
        Insert: never;
        Update: Partial<Omit<UserSettingsRow, 'user_id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

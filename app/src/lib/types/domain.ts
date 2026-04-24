// Shared domain types consumed by frontend pages and components.
// Source of truth: SOLUTION_DESIGN.md §2 (schema) + docs/architecture/sprint-1-build-spec.md §3.2 (API contracts).
// These mirror the API shapes. [backend-engineer] may re-derive or re-export from Zod schemas.

export type MemberRole = "owner" | "editor" | "viewer";

export type ItineraryItemType =
  | "transport"
  | "lodging"
  | "activity"
  | "meal"
  | "note";

export interface Trip {
  id: string;
  owner_id: string;
  name: string;
  start_date: string; // ISO YYYY-MM-DD
  end_date: string; // ISO YYYY-MM-DD
  destination: string | null;
  base_currency: string; // ISO 4217
  total_budget: number | null;
  created_at: string;
  updated_at: string;
}

export interface TripDay {
  id: string;
  trip_id: string;
  day_number: number;
  date: string; // ISO YYYY-MM-DD
  title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItineraryItem {
  id: string;
  trip_id: string;
  day_id: string | null;
  type: ItineraryItemType;
  title: string;
  start_time: string | null; // ISO 8601 with offset
  end_time: string | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface TripWithRole {
  trip: Trip;
  member: { role: MemberRole };
}

export interface DateShrinkBlockingDay {
  day_id: string;
  date: string;
  item_count: number;
}

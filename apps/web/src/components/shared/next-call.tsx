export interface Upcoming {
  meeting: {
    id: string;
    title: string;
    starts_at: string;
    conferencing_url: string | null;
  };
  company_name: string | null;
  role_title: string | null;
  stage_name: string | null;
  kind: string;
  starts_in_minutes: number;
}

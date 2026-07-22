export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      campaign_state: {
        Row: {
          campaign_id: string
          campaign_phase: string | null
          current_cycle: string
          current_cycle_day: number
          current_fear: number
          current_week: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          campaign_phase?: string | null
          current_cycle?: string
          current_cycle_day?: number
          current_fear?: number
          current_week?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          campaign_phase?: string | null
          current_cycle?: string
          current_cycle_day?: number
          current_fear?: number
          current_week?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_state_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_time_events: {
        Row: {
          campaign_id: string
          corrects_event_id: string | null
          created_at: string
          event_type: string
          id: string
          new_cycle: string
          new_cycle_day: number
          new_week: number
          note: string | null
          operation_id: string
          previous_cycle: string
          previous_cycle_day: number
          previous_week: number
        }
        Insert: {
          campaign_id: string
          corrects_event_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          new_cycle: string
          new_cycle_day: number
          new_week: number
          note?: string | null
          operation_id: string
          previous_cycle: string
          previous_cycle_day: number
          previous_week: number
        }
        Update: {
          campaign_id?: string
          corrects_event_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          new_cycle?: string
          new_cycle_day?: number
          new_week?: number
          note?: string | null
          operation_id?: string
          previous_cycle?: string
          previous_cycle_day?: number
          previous_week?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_time_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_time_events_correction_same_campaign_fkey"
            columns: ["campaign_id", "corrects_event_id"]
            isOneToOne: false
            referencedRelation: "campaign_time_events"
            referencedColumns: ["campaign_id", "id"]
          },
          {
            foreignKeyName: "campaign_time_events_operation_same_campaign_fkey"
            columns: ["campaign_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["campaign_id", "id"]
          },
        ]
      }
      campaigns: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      character_classes: {
        Row: {
          campaign_id: string
          created_at: string
          default_template_id: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          default_template_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          default_template_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_classes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_classes_default_template_same_campaign_fkey"
            columns: ["campaign_id", "default_template_id"]
            isOneToOne: false
            referencedRelation: "sheet_templates"
            referencedColumns: ["campaign_id", "id"]
          },
        ]
      }
      characters: {
        Row: {
          ancestry: string | null
          archived_at: string | null
          campaign_id: string
          class_id: string | null
          class_name: string | null
          community: string | null
          created_at: string
          id: string
          level: number
          name: string
          notes: string | null
          portrait_url: string | null
          pronouns: string | null
          sheet_template_id: string | null
          status: string
          subclass_name: string | null
          updated_at: string
        }
        Insert: {
          ancestry?: string | null
          archived_at?: string | null
          campaign_id: string
          class_id?: string | null
          class_name?: string | null
          community?: string | null
          created_at?: string
          id?: string
          level?: number
          name: string
          notes?: string | null
          portrait_url?: string | null
          pronouns?: string | null
          sheet_template_id?: string | null
          status?: string
          subclass_name?: string | null
          updated_at?: string
        }
        Update: {
          ancestry?: string | null
          archived_at?: string | null
          campaign_id?: string
          class_id?: string | null
          class_name?: string | null
          community?: string | null
          created_at?: string
          id?: string
          level?: number
          name?: string
          notes?: string | null
          portrait_url?: string | null
          pronouns?: string | null
          sheet_template_id?: string | null
          status?: string
          subclass_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "characters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_class_same_campaign_fkey"
            columns: ["campaign_id", "class_id"]
            isOneToOne: false
            referencedRelation: "character_classes"
            referencedColumns: ["campaign_id", "id"]
          },
          {
            foreignKeyName: "characters_template_same_campaign_fkey"
            columns: ["campaign_id", "sheet_template_id"]
            isOneToOne: false
            referencedRelation: "sheet_templates"
            referencedColumns: ["campaign_id", "id"]
          },
        ]
      }
      countdown_events: {
        Row: {
          change_amount: number
          countdown_id: string
          created_at: string
          created_by: string
          event_type: string
          id: string
          idempotency_key: string | null
          new_status: string | null
          new_value: number
          operation_id: string | null
          previous_status: string | null
          previous_value: number
          reason: string | null
        }
        Insert: {
          change_amount: number
          countdown_id: string
          created_at?: string
          created_by: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          new_status?: string | null
          new_value: number
          operation_id?: string | null
          previous_status?: string | null
          previous_value: number
          reason?: string | null
        }
        Update: {
          change_amount?: number
          countdown_id?: string
          created_at?: string
          created_by?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          new_status?: string | null
          new_value?: number
          operation_id?: string | null
          previous_status?: string | null
          previous_value?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "countdown_events_countdown_id_fkey"
            columns: ["countdown_id"]
            isOneToOne: false
            referencedRelation: "countdowns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "countdown_events_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
        ]
      }
      countdowns: {
        Row: {
          archived_at: string | null
          campaign_id: string
          category: string
          completed_at: string | null
          consequence: string | null
          created_at: string
          current_value: number
          description: string | null
          direction: string
          id: string
          idempotency_key: string | null
          linked_entity_id: string | null
          linked_entity_type: string | null
          name: string
          starting_value: number
          status: string
          target_value: number
          updated_at: string
          visibility: string
        }
        Insert: {
          archived_at?: string | null
          campaign_id: string
          category: string
          completed_at?: string | null
          consequence?: string | null
          created_at?: string
          current_value: number
          description?: string | null
          direction: string
          id?: string
          idempotency_key?: string | null
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          name: string
          starting_value: number
          status?: string
          target_value: number
          updated_at?: string
          visibility?: string
        }
        Update: {
          archived_at?: string | null
          campaign_id?: string
          category?: string
          completed_at?: string | null
          consequence?: string | null
          created_at?: string
          current_value?: number
          description?: string | null
          direction?: string
          id?: string
          idempotency_key?: string | null
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          name?: string
          starting_value?: number
          status?: string
          target_value?: number
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "countdowns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      fear_events: {
        Row: {
          amount: number
          campaign_id: string
          created_at: string
          created_by: string
          event_type: string
          id: string
          idempotency_key: string
          new_value: number
          operation_id: string | null
          previous_value: number
        }
        Insert: {
          amount: number
          campaign_id: string
          created_at?: string
          created_by: string
          event_type: string
          id?: string
          idempotency_key: string
          new_value: number
          operation_id?: string | null
          previous_value: number
        }
        Update: {
          amount?: number
          campaign_id?: string
          created_at?: string
          created_by?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          new_value?: number
          operation_id?: string | null
          previous_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fear_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fear_events_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
        ]
      }
      operations: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          metadata: Json | null
          operation_type: string
          reverses_operation_id: string | null
          summary: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          metadata?: Json | null
          operation_type: string
          reverses_operation_id?: string | null
          summary: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          metadata?: Json | null
          operation_type?: string
          reverses_operation_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_reversal_same_campaign_fkey"
            columns: ["campaign_id", "reverses_operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["campaign_id", "id"]
          },
        ]
      }
      sheet_template_fields: {
        Row: {
          campaign_id: string
          configuration: Json
          created_at: string
          display_order: number
          field_key: string
          field_type: string
          height: number
          id: string
          is_active: boolean
          is_required: boolean
          label: string
          page_number: number
          template_version_id: string
          updated_at: string
          width: number
          x: number
          y: number
        }
        Insert: {
          campaign_id: string
          configuration?: Json
          created_at?: string
          display_order?: number
          field_key: string
          field_type: string
          height: number
          id?: string
          is_active?: boolean
          is_required?: boolean
          label: string
          page_number: number
          template_version_id: string
          updated_at?: string
          width: number
          x: number
          y: number
        }
        Update: {
          campaign_id?: string
          configuration?: Json
          created_at?: string
          display_order?: number
          field_key?: string
          field_type?: string
          height?: number
          id?: string
          is_active?: boolean
          is_required?: boolean
          label?: string
          page_number?: number
          template_version_id?: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "sheet_template_fields_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_template_fields_version_same_campaign_fkey"
            columns: ["campaign_id", "template_version_id"]
            isOneToOne: false
            referencedRelation: "sheet_template_versions"
            referencedColumns: ["campaign_id", "id"]
          },
        ]
      }
      sheet_template_versions: {
        Row: {
          campaign_id: string
          checksum: string
          created_at: string
          created_by: string
          id: string
          layout_status: string
          mime_type: string
          original_filename: string
          page_count: number
          published_at: string | null
          size_bytes: number
          source_bucket: string
          source_object_path: string
          status: string
          template_id: string
          version_number: number
        }
        Insert: {
          campaign_id: string
          checksum: string
          created_at?: string
          created_by: string
          id?: string
          layout_status?: string
          mime_type: string
          original_filename: string
          page_count: number
          published_at?: string | null
          size_bytes: number
          source_bucket: string
          source_object_path: string
          status?: string
          template_id: string
          version_number: number
        }
        Update: {
          campaign_id?: string
          checksum?: string
          created_at?: string
          created_by?: string
          id?: string
          layout_status?: string
          mime_type?: string
          original_filename?: string
          page_count?: number
          published_at?: string | null
          size_bytes?: number
          source_bucket?: string
          source_object_path?: string
          status?: string
          template_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "sheet_template_versions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_template_versions_template_same_campaign_fkey"
            columns: ["campaign_id", "template_id"]
            isOneToOne: false
            referencedRelation: "sheet_templates"
            referencedColumns: ["campaign_id", "id"]
          },
        ]
      }
      sheet_templates: {
        Row: {
          active_version_id: string | null
          campaign_id: string
          class_id: string | null
          created_at: string
          id: string
          is_blank_template: boolean
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          active_version_id?: string | null
          campaign_id: string
          class_id?: string | null
          created_at?: string
          id?: string
          is_blank_template?: boolean
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          active_version_id?: string | null
          campaign_id?: string
          class_id?: string | null
          created_at?: string
          id?: string
          is_blank_template?: boolean
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_templates_class_same_campaign_fkey"
            columns: ["campaign_id", "class_id"]
            isOneToOne: false
            referencedRelation: "character_classes"
            referencedColumns: ["campaign_id", "id"]
          },
          {
            foreignKeyName: "sheet_templates_active_version_same_campaign_fkey"
            columns: ["campaign_id", "active_version_id"]
            isOneToOne: false
            referencedRelation: "sheet_template_versions"
            referencedColumns: ["campaign_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_campaign_fear: {
        Args: {
          p_amount: number
          p_campaign_id: string
          p_event_type: string
          p_idempotency_key: string
        }
        Returns: {
          change_amount: number
          event_created_at: string
          event_id: string
          new_value: number
          previous_value: number
          returned_event_type: string
          was_applied: boolean
        }[]
      }
      change_campaign_time: {
        Args: {
          p_campaign_id: string
          p_corrects_event_id?: string
          p_idempotency_key: string
          p_intent: string
          p_note?: string
          p_target_cycle?: string
          p_target_cycle_day?: number
          p_target_week?: number
        }
        Returns: {
          event_created_at: string
          event_id: string
          new_cycle: string
          new_cycle_day: number
          new_week: number
          operation_id: string
          previous_cycle: string
          previous_cycle_day: number
          previous_week: number
          returned_corrects_event_id: string
          returned_event_type: string
          returned_note: string
          was_applied: boolean
        }[]
      }
      create_campaign_countdown: {
        Args: {
          p_campaign_id: string
          p_category: string
          p_consequence: string
          p_description: string
          p_idempotency_key: string
          p_name: string
          p_starting_value: number
        }
        Returns: {
          countdown_created_at: string
          countdown_id: string
          returned_category: string
          returned_consequence: string
          returned_current_value: number
          returned_description: string
          returned_name: string
          returned_starting_value: number
          returned_status: string
          was_applied: boolean
        }[]
      }
      archive_sheet_template_version: {
        Args: { p_version_id: string }
        Returns: {
          returned_active_version_id: string
          returned_status: string
          returned_template_id: string
          version_id: string
        }[]
      }
      create_sheet_template_version: {
        Args: {
          p_checksum: string
          p_original_filename: string
          p_page_count: number
          p_size_bytes: number
          p_source_object_path: string
          p_template_id: string
          p_version_id: string
        }
        Returns: {
          returned_checksum: string
          returned_original_filename: string
          returned_page_count: number
          returned_size_bytes: number
          returned_source_bucket: string
          returned_source_object_path: string
          returned_status: string
          returned_template_id: string
          returned_version_number: number
          version_created_at: string
          version_id: string
        }[]
      }
      save_sheet_template_fields: {
        Args: { p_template_version_id: string; p_fields: Json }
        Returns: number
      }
      publish_sheet_template_version: {
        Args: { p_template_version_id: string }
        Returns: {
          returned_layout_status: string
          returned_published_at: string
          version_id: string
        }[]
      }
      create_sheet_template_revision: {
        Args: {
          p_new_object_path: string
          p_new_version_id: string
          p_source_version_id: string
        }
        Returns: {
          returned_layout_status: string
          returned_version_number: number
          version_id: string
        }[]
      }
      create_character: {
        Args: {
          p_campaign_id: string
          p_class_id: string
          p_name: string
          p_notes: string
          p_sheet_template_id: string | null
        }
        Returns: {
          character_created_at: string
          character_id: string
          returned_class_id: string
          returned_name: string
          returned_sheet_template_id: string
          returned_status: string
        }[]
      }
      update_character: {
        Args: {
          p_character_id: string
          p_name: string
          p_notes: string
          p_status: string
        }
        Returns: {
          character_id: string
          character_updated_at: string
          returned_name: string
          returned_notes: string
          returned_status: string
        }[]
      }
      operate_countdown: {
        Args: {
          p_action: string
          p_change_amount: number
          p_countdown_id: string
          p_idempotency_key: string
          p_reason: string
        }
        Returns: {
          change_amount: number
          event_created_at: string
          event_id: string
          new_status: string
          new_value: number
          previous_status: string
          previous_value: number
          returned_event_type: string
          returned_reason: string
          was_applied: boolean
        }[]
      }
      owns_campaign: { Args: { target_campaign_id: string }; Returns: boolean }
      owns_countdown: {
        Args: { target_countdown_id: string }
        Returns: boolean
      }
      record_operation: {
        Args: {
          p_campaign_id: string
          p_idempotency_key: string
          p_metadata?: Json
          p_operation_type: string
          p_reverses_operation_id?: string
          p_summary: string
        }
        Returns: {
          operation_created_at: string
          operation_id: string
          returned_campaign_id: string
          returned_created_by: string
          returned_idempotency_key: string
          returned_metadata: Json
          returned_operation_type: string
          returned_reverses_operation_id: string
          returned_summary: string
          was_applied: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      apps: {
        Row: {
          access_pattern: string
          category: string
          code: string
          created_at: string
          deploy_url: string | null
          description: string | null
          display_name: string
          icon: string | null
          id: string
          sort_order: number
          status: string
          subdomain: string | null
          theme_accent_color: string | null
          theme_primary_color: string | null
          updated_at: string
        }
        Insert: {
          access_pattern: string
          category?: string
          code: string
          created_at?: string
          deploy_url?: string | null
          description?: string | null
          display_name: string
          icon?: string | null
          id?: string
          sort_order?: number
          status?: string
          subdomain?: string | null
          theme_accent_color?: string | null
          theme_primary_color?: string | null
          updated_at?: string
        }
        Update: {
          access_pattern?: string
          category?: string
          code?: string
          created_at?: string
          deploy_url?: string | null
          description?: string | null
          display_name?: string
          icon?: string | null
          id?: string
          sort_order?: number
          status?: string
          subdomain?: string | null
          theme_accent_color?: string | null
          theme_primary_color?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          changes: Json | null
          entity_display_reference: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          legal_entity_id: string | null
          occurred_at: string
          outlet_id: string | null
          reason: string | null
          source_app: string | null
          user_agent: string | null
          user_display_name: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          entity_display_reference?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          legal_entity_id?: string | null
          occurred_at?: string
          outlet_id?: string | null
          reason?: string | null
          source_app?: string | null
          user_agent?: string | null
          user_display_name?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          entity_display_reference?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          legal_entity_id?: string | null
          occurred_at?: string
          outlet_id?: string | null
          reason?: string | null
          source_app?: string | null
          user_agent?: string | null
          user_display_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          assigned_to_user_id: string | null
          category: string | null
          console_errors: Json | null
          created_at: string
          description: string | null
          id: string
          legal_entity_id: string | null
          network_errors: Json | null
          occurred_at: string
          outlet_id: string | null
          reported_by_user_id: string | null
          reporter_display_name: string | null
          reporter_email: string | null
          resolution_notes: string | null
          resolved_at: string | null
          screen_size: string | null
          screenshot_url: string | null
          severity: string
          source_app: string
          source_url: string | null
          status: string
          title: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          assigned_to_user_id?: string | null
          category?: string | null
          console_errors?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          legal_entity_id?: string | null
          network_errors?: Json | null
          occurred_at?: string
          outlet_id?: string | null
          reported_by_user_id?: string | null
          reporter_display_name?: string | null
          reporter_email?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          screen_size?: string | null
          screenshot_url?: string | null
          severity?: string
          source_app: string
          source_url?: string | null
          status?: string
          title: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          assigned_to_user_id?: string | null
          category?: string | null
          console_errors?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          legal_entity_id?: string | null
          network_errors?: Json | null
          occurred_at?: string
          outlet_id?: string | null
          reported_by_user_id?: string | null
          reporter_display_name?: string | null
          reporter_email?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          screen_size?: string | null
          screenshot_url?: string | null
          severity?: string
          source_app?: string
          source_url?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_reported_by_user_id_fkey"
            columns: ["reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_reported_by_user_id_fkey"
            columns: ["reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          audit_log_id: string | null
          details: Json | null
          event_type: string
          id: string
          integration_id: string
          message: string
          occurred_at: string
          severity: string
        }
        Insert: {
          audit_log_id?: string | null
          details?: Json | null
          event_type: string
          id?: string
          integration_id: string
          message: string
          occurred_at?: string
          severity?: string
        }
        Update: {
          audit_log_id?: string | null
          details?: Json | null
          event_type?: string
          id?: string
          integration_id?: string
          message?: string
          occurred_at?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          config_version: number
          consecutive_errors: number
          created_at: string
          description: string | null
          display_name: string
          id: string
          integration_type: string
          last_error_at: string | null
          last_error_message: string | null
          last_sync_at: string | null
          legal_entity_id: string
          notes: string | null
          secrets_vault_key: string | null
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          config_version?: number
          consecutive_errors?: number
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          integration_type: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_sync_at?: string | null
          legal_entity_id: string
          notes?: string | null
          secrets_vault_key?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          config_version?: number
          consecutive_errors?: number
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          integration_type?: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_sync_at?: string | null
          legal_entity_id?: string
          notes?: string | null
          secrets_vault_key?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_entities: {
        Row: {
          bank_account: string | null
          created_at: string
          iban: string | null
          id: string
          invoice_address_line1: string | null
          invoice_address_line2: string | null
          invoice_city: string | null
          invoice_country: string
          invoice_postal_code: string | null
          legal_name: string
          logo_url: string | null
          mva_registered: boolean
          notes: string | null
          org_number: string
          short_code: string
          signature_color: string | null
          status: string
          swift: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          bank_account?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          invoice_address_line1?: string | null
          invoice_address_line2?: string | null
          invoice_city?: string | null
          invoice_country?: string
          invoice_postal_code?: string | null
          legal_name: string
          logo_url?: string | null
          mva_registered?: boolean
          notes?: string | null
          org_number: string
          short_code: string
          signature_color?: string | null
          status?: string
          swift?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          bank_account?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          invoice_address_line1?: string | null
          invoice_address_line2?: string | null
          invoice_city?: string | null
          invoice_country?: string
          invoice_postal_code?: string | null
          legal_name?: string
          logo_url?: string | null
          mva_registered?: boolean
          notes?: string | null
          org_number?: string
          short_code?: string
          signature_color?: string | null
          status?: string
          swift?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      number_sequences: {
        Row: {
          domain: string
          legal_entity_id: string
          next_number: number
        }
        Insert: {
          domain: string
          legal_entity_id: string
          next_number?: number
        }
        Update: {
          domain?: string
          legal_entity_id?: string
          next_number?: number
        }
        Relationships: []
      }
      outlets: {
        Row: {
          address_line1: string | null
          billing_customer_id: string | null
          city: string | null
          closed_at: string | null
          country: string | null
          created_at: string
          display_number: number
          email: string | null
          full_name: string | null
          id: string
          legal_entity_id: string
          notes: string | null
          opened_at: string | null
          opening_hours: Json | null
          outlet_type: string
          phone: string | null
          postal_code: string | null
          short_name: string
          status: string
          tripletex_department_code: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          billing_customer_id?: string | null
          city?: string | null
          closed_at?: string | null
          country?: string | null
          created_at?: string
          display_number: number
          email?: string | null
          full_name?: string | null
          id?: string
          legal_entity_id: string
          notes?: string | null
          opened_at?: string | null
          opening_hours?: Json | null
          outlet_type: string
          phone?: string | null
          postal_code?: string | null
          short_name: string
          status?: string
          tripletex_department_code?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          billing_customer_id?: string | null
          city?: string | null
          closed_at?: string | null
          country?: string | null
          created_at?: string
          display_number?: number
          email?: string | null
          full_name?: string | null
          id?: string
          legal_entity_id?: string
          notes?: string | null
          opened_at?: string | null
          opening_hours?: Json | null
          outlet_type?: string
          phone?: string | null
          postal_code?: string | null
          short_name?: string
          status?: string
          tripletex_department_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlets_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      position_app_access: {
        Row: {
          app_id: string
          level: Database["public"]["Enums"]["access_level"]
          position_id: string
        }
        Insert: {
          app_id: string
          level?: Database["public"]["Enums"]["access_level"]
          position_id: string
        }
        Update: {
          app_id?: string
          level?: Database["public"]["Enums"]["access_level"]
          position_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_app_access_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_app_access_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      position_module_access: {
        Row: {
          app_id: string
          level: Database["public"]["Enums"]["access_level"]
          module_key: string
          position_id: string
        }
        Insert: {
          app_id: string
          level: Database["public"]["Enums"]["access_level"]
          module_key: string
          position_id: string
        }
        Update: {
          app_id?: string
          level?: Database["public"]["Enums"]["access_level"]
          module_key?: string
          position_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_module_access_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_module_access_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      position_widgets: {
        Row: {
          is_mandatory: boolean
          position_id: string
          sort_order: number
          widget_code: string
        }
        Insert: {
          is_mandatory?: boolean
          position_id: string
          sort_order?: number
          widget_code: string
        }
        Update: {
          is_mandatory?: boolean
          position_id?: string
          sort_order?: number
          widget_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_widgets_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_widgets_widget_code_fkey"
            columns: ["widget_code"]
            isOneToOne: false
            referencedRelation: "widget_registry"
            referencedColumns: ["code"]
          },
        ]
      }
      positions: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          scope_pattern: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          scope_pattern: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          scope_pattern?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_positions: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          is_primary: boolean
          legal_entity_id: string
          notes: string | null
          outlet_ids: string[]
          outlet_scope: string
          position_id: string
          updated_at: string
          user_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          legal_entity_id: string
          notes?: string | null
          outlet_ids?: string[]
          outlet_scope: string
          position_id: string
          updated_at?: string
          user_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          legal_entity_id?: string
          notes?: string | null
          outlet_ids?: string[]
          outlet_scope?: string
          position_id?: string
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_positions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_positions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_positions_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_positions_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_widget_preferences: {
        Row: {
          custom_size: string | null
          custom_sort_order: number | null
          hidden: boolean
          settings: Json
          user_id: string
          widget_code: string
        }
        Insert: {
          custom_size?: string | null
          custom_sort_order?: number | null
          hidden?: boolean
          settings?: Json
          user_id: string
          widget_code: string
        }
        Update: {
          custom_size?: string | null
          custom_sort_order?: number | null
          hidden?: boolean
          settings?: Json
          user_id?: string
          widget_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_widget_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_widget_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_widget_preferences_widget_code_fkey"
            columns: ["widget_code"]
            isOneToOne: false
            referencedRelation: "widget_registry"
            referencedColumns: ["code"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string
          first_name: string | null
          id: string
          last_login_at: string | null
          last_name: string | null
          notes: string | null
          onboarded_at: string | null
          phone: string | null
          preferences: Json
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email: string
          first_name?: string | null
          id: string
          last_login_at?: string | null
          last_name?: string | null
          notes?: string | null
          onboarded_at?: string | null
          phone?: string | null
          preferences?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string
          first_name?: string | null
          id?: string
          last_login_at?: string | null
          last_name?: string | null
          notes?: string | null
          onboarded_at?: string | null
          phone?: string | null
          preferences?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      widget_registry: {
        Row: {
          code: string
          created_at: string
          default_size: string
          description: string | null
          display_name: string
          id: string
          required_app_code: string | null
          status: string
        }
        Insert: {
          code: string
          created_at?: string
          default_size?: string
          description?: string | null
          display_name: string
          id?: string
          required_app_code?: string | null
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_size?: string
          description?: string | null
          display_name?: string
          id?: string
          required_app_code?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_registry_required_app_code_fkey"
            columns: ["required_app_code"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      users_public: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          status: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          status?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      app_access_level: {
        Args: { p_app_code: string }
        Returns: Database["public"]["Enums"]["access_level"]
      }
      current_user_entity_ids: { Args: never; Returns: string[] }
      current_user_id: { Args: never; Returns: string }
      current_user_positions: {
        Args: never
        Returns: {
          legal_entity_id: string
          outlet_ids: string[]
          outlet_scope: string
          position_code: string
        }[]
      }
      has_access_to_outlet: { Args: { p_outlet_id: string }; Returns: boolean }
      has_active_position: {
        Args: { p_position_code: string }
        Returns: boolean
      }
      has_position_in_entity: {
        Args: { p_legal_entity_id: string }
        Returns: boolean
      }
      has_specific_position_in_entity: {
        Args: { p_legal_entity_id: string; p_position_code: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      next_display_number: {
        Args: { p_domain: string; p_legal_entity_id: string }
        Returns: number
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      access_level: "none" | "read" | "write" | "approve" | "admin"
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
    Enums: {
      access_level: ["none", "read", "write", "approve", "admin"],
    },
  },
} as const

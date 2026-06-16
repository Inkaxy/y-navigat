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
      _pos_smoke_debug: {
        Row: {
          id: number
          note: string | null
          ts: string | null
        }
        Insert: {
          id?: number
          note?: string | null
          ts?: string | null
        }
        Update: {
          id?: number
          note?: string | null
          ts?: string | null
        }
        Relationships: []
      }
      _pos_smoke_results: {
        Row: {
          msg: string | null
          recorded_at: string | null
          sqlstate: string | null
          test: string
        }
        Insert: {
          msg?: string | null
          recorded_at?: string | null
          sqlstate?: string | null
          test: string
        }
        Update: {
          msg?: string | null
          recorded_at?: string | null
          sqlstate?: string | null
          test?: string
        }
        Relationships: []
      }
      _x_audit: {
        Row: {
          result: Json | null
          sid: string | null
        }
        Insert: {
          result?: Json | null
          sid?: string | null
        }
        Update: {
          result?: Json | null
          sid?: string | null
        }
        Relationships: []
      }
      ai_call_log: {
        Row: {
          completion_tokens: number | null
          confidence_score: number | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          model: string
          prompt_tokens: number | null
          provider: string
          request_payload: Json | null
          response_payload: Json | null
          status: string
          ticket_id: string | null
          triggered_by: string | null
        }
        Insert: {
          completion_tokens?: number | null
          confidence_score?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          model: string
          prompt_tokens?: number | null
          provider: string
          request_payload?: Json | null
          response_payload?: Json | null
          status: string
          ticket_id?: string | null
          triggered_by?: string | null
        }
        Update: {
          completion_tokens?: number | null
          confidence_score?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          model?: string
          prompt_tokens?: number | null
          provider?: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
          ticket_id?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_log_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_config: {
        Row: {
          azure_deployment: string | null
          azure_endpoint: string | null
          created_at: string
          encrypted_api_key: string
          id: string
          is_active: boolean
          max_tokens: number
          model: string
          provider: string
          purpose: string
          temperature: number
          updated_at: string
        }
        Insert: {
          azure_deployment?: string | null
          azure_endpoint?: string | null
          created_at?: string
          encrypted_api_key: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model: string
          provider: string
          purpose: string
          temperature?: number
          updated_at?: string
        }
        Update: {
          azure_deployment?: string | null
          azure_endpoint?: string | null
          created_at?: string
          encrypted_api_key?: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model?: string
          provider?: string
          purpose?: string
          temperature?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          created_at: string
          error_message: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          invoice_id: string | null
          legal_entity_id: string | null
          model: string
          output_tokens: number | null
          provider: string
          purpose: string
          success: boolean
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          invoice_id?: string | null
          legal_entity_id?: string | null
          model: string
          output_tokens?: number | null
          provider: string
          purpose: string
          success?: boolean
        }
        Update: {
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          invoice_id?: string | null
          legal_entity_id?: string | null
          model?: string
          output_tokens?: number | null
          provider?: string
          purpose?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      apps: {
        Row: {
          access_pattern: string
          category: string
          code: string
          color_hex: string
          created_at: string
          deploy_url: string | null
          description: string | null
          display_name: string
          icon: string | null
          id: string
          sort_order: number
          start_path: string
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
          color_hex?: string
          created_at?: string
          deploy_url?: string | null
          description?: string | null
          display_name: string
          icon?: string | null
          id?: string
          sort_order?: number
          start_path?: string
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
          color_hex?: string
          created_at?: string
          deploy_url?: string | null
          description?: string | null
          display_name?: string
          icon?: string | null
          id?: string
          sort_order?: number
          start_path?: string
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
      cake_categories: {
        Row: {
          base_price: number
          base_product_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          image_url: string | null
          legal_entity_id: string
          name: string
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_price?: number
          base_product_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          legal_entity_id: string
          name: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_price?: number
          base_product_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          legal_entity_id?: string
          name?: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cake_categories_base_product_id_fkey"
            columns: ["base_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cake_categories_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      cake_compatibility_rules: {
        Row: {
          cake_category_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          message: string
          name: string
          response_options: Json
          rule_type: string
          severity: string
          sort_order: number
          trigger_product_ids: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cake_category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          message: string
          name: string
          response_options?: Json
          rule_type?: string
          severity?: string
          sort_order?: number
          trigger_product_ids: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cake_category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          message?: string
          name?: string
          response_options?: Json
          rule_type?: string
          severity?: string
          sort_order?: number
          trigger_product_ids?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cake_compatibility_rules_cake_category_id_fkey"
            columns: ["cake_category_id"]
            isOneToOne: false
            referencedRelation: "cake_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cake_step_products: {
        Row: {
          cake_step_id: string
          created_at: string
          custom_extra_price: number
          custom_image_url: string | null
          custom_name: string | null
          default_selected: boolean
          display_name_override: string | null
          id: string
          is_variant_default: boolean
          product_id: string | null
          sort_order: number
          variant_group_label: string | null
        }
        Insert: {
          cake_step_id: string
          created_at?: string
          custom_extra_price?: number
          custom_image_url?: string | null
          custom_name?: string | null
          default_selected?: boolean
          display_name_override?: string | null
          id?: string
          is_variant_default?: boolean
          product_id?: string | null
          sort_order?: number
          variant_group_label?: string | null
        }
        Update: {
          cake_step_id?: string
          created_at?: string
          custom_extra_price?: number
          custom_image_url?: string | null
          custom_name?: string | null
          default_selected?: boolean
          display_name_override?: string | null
          id?: string
          is_variant_default?: boolean
          product_id?: string | null
          sort_order?: number
          variant_group_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cake_step_products_cake_step_id_fkey"
            columns: ["cake_step_id"]
            isOneToOne: false
            referencedRelation: "cake_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cake_step_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      cake_steps: {
        Row: {
          cake_category_id: string
          created_at: string
          description: string | null
          extra_unit_price: number
          id: string
          included_quantity: number
          label_field_key: string | null
          max_selections: number | null
          min_selections: number | null
          name: string
          required: boolean
          selection_type: string
          step_order: number
          suggested_role: string | null
          updated_at: string
        }
        Insert: {
          cake_category_id: string
          created_at?: string
          description?: string | null
          extra_unit_price?: number
          id?: string
          included_quantity?: number
          label_field_key?: string | null
          max_selections?: number | null
          min_selections?: number | null
          name: string
          required?: boolean
          selection_type: string
          step_order: number
          suggested_role?: string | null
          updated_at?: string
        }
        Update: {
          cake_category_id?: string
          created_at?: string
          description?: string | null
          extra_unit_price?: number
          id?: string
          included_quantity?: number
          label_field_key?: string | null
          max_selections?: number | null
          min_selections?: number | null
          name?: string
          required?: boolean
          selection_type?: string
          step_order?: number
          suggested_role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cake_steps_cake_category_id_fkey"
            columns: ["cake_category_id"]
            isOneToOne: false
            referencedRelation: "cake_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          email: string | null
          id: string
          is_primary: boolean
          legal_entity_id: string
          mobile: string | null
          name: string
          notes: string | null
          phone: string | null
          role: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          email?: string | null
          id?: string
          is_primary?: boolean
          legal_entity_id: string
          mobile?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          legal_entity_id?: string
          mobile?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_group_members: {
        Row: {
          added_at: string
          added_by: string | null
          customer_id: string
          group_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          customer_id: string
          group_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          customer_id?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_group_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "customer_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_groups: {
        Row: {
          code: string
          color_hex: string | null
          created_at: string
          created_by: string | null
          default_price_list_id: string | null
          description: string | null
          display_name: string
          id: string
          legal_entity_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          color_hex?: string | null
          created_at?: string
          created_by?: string | null
          default_price_list_id?: string | null
          description?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          color_hex?: string | null
          created_at?: string
          created_by?: string | null
          default_price_list_id?: string | null
          description?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_groups_default_price_list_id_fkey"
            columns: ["default_price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_portal_accounts: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_profile_price_lists: {
        Row: {
          created_at: string
          customer_profile_id: string
          price_list_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          customer_profile_id: string
          price_list_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          customer_profile_id?: string
          price_list_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_profile_price_lists_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profile_price_lists_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_profiles: {
        Row: {
          code: string
          combine_orders_period: string | null
          copy_invoice_to_email: string | null
          created_at: string
          created_by: string | null
          default_customer_category: string | null
          default_department_project: string | null
          default_order_reference: string | null
          default_pickup_location: string | null
          description: string | null
          display_name: string
          expects_order_friday: boolean | null
          expects_order_monday: boolean | null
          expects_order_saturday: boolean | null
          expects_order_sunday: boolean | null
          expects_order_thursday: boolean | null
          expects_order_tuesday: boolean | null
          expects_order_wednesday: boolean | null
          fixed_discount_percent: number | null
          id: string
          include_attachments_in_ehf: boolean | null
          include_change_log_on_packing_slip: boolean | null
          include_empty_lines: boolean | null
          include_store_number_in_contact_id: boolean | null
          invoice_attachment: string | null
          invoice_method: string | null
          invoicing_group: string | null
          invoicing_profile: string | null
          is_private_person_default: boolean
          legal_entity_id: string
          mva_code: string | null
          next_customer_number: number
          next_order_same_route_on_packing_slip: boolean | null
          offer_delivery_report: boolean | null
          one_order_per_invoice: boolean | null
          only_products_with_price_in_offer_group: boolean | null
          order_confirmation_emails: string | null
          order_confirmation_mode: string | null
          packing_slip_delivery_mode: string | null
          packing_slip_emails: string | null
          payment_terms_days: number | null
          pickup_location_id: string | null
          price_on_packing_slip: boolean | null
          print_declaration_labels: boolean | null
          retail_price_on_packing_slip: boolean | null
          return_price_reduction_percent: number | null
          send_to_pos_system: boolean | null
          show_price_list_to_customer: boolean | null
          skip_delivery_name_in_accounting_cost: boolean | null
          status: string
          sum_on_packing_slip: boolean | null
          updated_at: string
          use_retail_price: boolean | null
        }
        Insert: {
          code: string
          combine_orders_period?: string | null
          copy_invoice_to_email?: string | null
          created_at?: string
          created_by?: string | null
          default_customer_category?: string | null
          default_department_project?: string | null
          default_order_reference?: string | null
          default_pickup_location?: string | null
          description?: string | null
          display_name: string
          expects_order_friday?: boolean | null
          expects_order_monday?: boolean | null
          expects_order_saturday?: boolean | null
          expects_order_sunday?: boolean | null
          expects_order_thursday?: boolean | null
          expects_order_tuesday?: boolean | null
          expects_order_wednesday?: boolean | null
          fixed_discount_percent?: number | null
          id?: string
          include_attachments_in_ehf?: boolean | null
          include_change_log_on_packing_slip?: boolean | null
          include_empty_lines?: boolean | null
          include_store_number_in_contact_id?: boolean | null
          invoice_attachment?: string | null
          invoice_method?: string | null
          invoicing_group?: string | null
          invoicing_profile?: string | null
          is_private_person_default?: boolean
          legal_entity_id: string
          mva_code?: string | null
          next_customer_number?: number
          next_order_same_route_on_packing_slip?: boolean | null
          offer_delivery_report?: boolean | null
          one_order_per_invoice?: boolean | null
          only_products_with_price_in_offer_group?: boolean | null
          order_confirmation_emails?: string | null
          order_confirmation_mode?: string | null
          packing_slip_delivery_mode?: string | null
          packing_slip_emails?: string | null
          payment_terms_days?: number | null
          pickup_location_id?: string | null
          price_on_packing_slip?: boolean | null
          print_declaration_labels?: boolean | null
          retail_price_on_packing_slip?: boolean | null
          return_price_reduction_percent?: number | null
          send_to_pos_system?: boolean | null
          show_price_list_to_customer?: boolean | null
          skip_delivery_name_in_accounting_cost?: boolean | null
          status?: string
          sum_on_packing_slip?: boolean | null
          updated_at?: string
          use_retail_price?: boolean | null
        }
        Update: {
          code?: string
          combine_orders_period?: string | null
          copy_invoice_to_email?: string | null
          created_at?: string
          created_by?: string | null
          default_customer_category?: string | null
          default_department_project?: string | null
          default_order_reference?: string | null
          default_pickup_location?: string | null
          description?: string | null
          display_name?: string
          expects_order_friday?: boolean | null
          expects_order_monday?: boolean | null
          expects_order_saturday?: boolean | null
          expects_order_sunday?: boolean | null
          expects_order_thursday?: boolean | null
          expects_order_tuesday?: boolean | null
          expects_order_wednesday?: boolean | null
          fixed_discount_percent?: number | null
          id?: string
          include_attachments_in_ehf?: boolean | null
          include_change_log_on_packing_slip?: boolean | null
          include_empty_lines?: boolean | null
          include_store_number_in_contact_id?: boolean | null
          invoice_attachment?: string | null
          invoice_method?: string | null
          invoicing_group?: string | null
          invoicing_profile?: string | null
          is_private_person_default?: boolean
          legal_entity_id?: string
          mva_code?: string | null
          next_customer_number?: number
          next_order_same_route_on_packing_slip?: boolean | null
          offer_delivery_report?: boolean | null
          one_order_per_invoice?: boolean | null
          only_products_with_price_in_offer_group?: boolean | null
          order_confirmation_emails?: string | null
          order_confirmation_mode?: string | null
          packing_slip_delivery_mode?: string | null
          packing_slip_emails?: string | null
          payment_terms_days?: number | null
          pickup_location_id?: string | null
          price_on_packing_slip?: boolean | null
          print_declaration_labels?: boolean | null
          retail_price_on_packing_slip?: boolean | null
          return_price_reduction_percent?: number | null
          send_to_pos_system?: boolean | null
          show_price_list_to_customer?: boolean | null
          skip_delivery_name_in_accounting_cost?: boolean | null
          status?: string
          sum_on_packing_slip?: boolean | null
          updated_at?: string
          use_retail_price?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_pickup_location_id_fkey"
            columns: ["pickup_location_id"]
            isOneToOne: false
            referencedRelation: "pickup_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          allows_returns: boolean
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_city: string | null
          billing_country: string | null
          billing_postal_code: string | null
          cake_builder_price_mode: string
          created_at: string
          created_by: string | null
          credit_days: number | null
          credit_hold: boolean
          credit_hold_reason: string | null
          credit_limit: number | null
          custom_reference: string | null
          customer_category: string | null
          customer_number: string
          customer_profile_id: string | null
          customer_type: string
          default_price_list_id: string | null
          delivery_address_line1: string | null
          delivery_address_line2: string | null
          delivery_city: string | null
          delivery_country: string | null
          delivery_instructions: string | null
          delivery_postal_code: string | null
          display_name: string
          ehf_participant: string | null
          enforce_custom_reference: boolean
          geocode_latitude: number | null
          geocode_longitude: number | null
          geocode_source: string | null
          geocode_updated_at: string | null
          gln: string | null
          id: string
          invoice_email: string | null
          invoice_recipient_customer_id: string | null
          is_private_person: boolean
          legal_entity_id: string
          mobile_phone: string | null
          notes: string | null
          organization_number: string | null
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          profile_overrides: Json
          status: string
          updated_at: string
        }
        Insert: {
          allows_returns?: boolean
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
          cake_builder_price_mode?: string
          created_at?: string
          created_by?: string | null
          credit_days?: number | null
          credit_hold?: boolean
          credit_hold_reason?: string | null
          credit_limit?: number | null
          custom_reference?: string | null
          customer_category?: string | null
          customer_number: string
          customer_profile_id?: string | null
          customer_type?: string
          default_price_list_id?: string | null
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_instructions?: string | null
          delivery_postal_code?: string | null
          display_name: string
          ehf_participant?: string | null
          enforce_custom_reference?: boolean
          geocode_latitude?: number | null
          geocode_longitude?: number | null
          geocode_source?: string | null
          geocode_updated_at?: string | null
          gln?: string | null
          id?: string
          invoice_email?: string | null
          invoice_recipient_customer_id?: string | null
          is_private_person?: boolean
          legal_entity_id: string
          mobile_phone?: string | null
          notes?: string | null
          organization_number?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          profile_overrides?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          allows_returns?: boolean
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
          cake_builder_price_mode?: string
          created_at?: string
          created_by?: string | null
          credit_days?: number | null
          credit_hold?: boolean
          credit_hold_reason?: string | null
          credit_limit?: number | null
          custom_reference?: string | null
          customer_category?: string | null
          customer_number?: string
          customer_profile_id?: string | null
          customer_type?: string
          default_price_list_id?: string | null
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_instructions?: string | null
          delivery_postal_code?: string | null
          display_name?: string
          ehf_participant?: string | null
          enforce_custom_reference?: boolean
          geocode_latitude?: number | null
          geocode_longitude?: number | null
          geocode_source?: string | null
          geocode_updated_at?: string | null
          gln?: string | null
          id?: string
          invoice_email?: string | null
          invoice_recipient_customer_id?: string | null
          is_private_person?: boolean
          legal_entity_id?: string
          mobile_phone?: string | null
          notes?: string | null
          organization_number?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          profile_overrides?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_default_price_list_id_fkey"
            columns: ["default_price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_invoice_recipient_customer_id_fkey"
            columns: ["invoice_recipient_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      datasheet_upload_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          failed: number
          id: string
          legal_entity_id: string
          processed: number
          status: string
          total_files: number
          uploaded_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          failed?: number
          id?: string
          legal_entity_id: string
          processed?: number
          status?: string
          total_files?: number
          uploaded_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          failed?: number
          id?: string
          legal_entity_id?: string
          processed?: number
          status?: string
          total_files?: number
          uploaded_by?: string | null
        }
        Relationships: []
      }
      delivery_note_lines: {
        Row: {
          created_at: string
          delivery_note_id: string
          discount_percent: number
          id: string
          line_number: number
          line_subtotal_excl_vat: number
          line_total_incl_vat: number
          line_vat: number
          merknad: Json | null
          notes: string | null
          order_id: string | null
          order_line_id: string | null
          product_id: string
          product_snapshot: Json
          quantity: number
          sales_unit: string
          unit_price: number
          vat_rate: number
        }
        Insert: {
          created_at?: string
          delivery_note_id: string
          discount_percent?: number
          id?: string
          line_number: number
          line_subtotal_excl_vat?: number
          line_total_incl_vat?: number
          line_vat?: number
          merknad?: Json | null
          notes?: string | null
          order_id?: string | null
          order_line_id?: string | null
          product_id: string
          product_snapshot?: Json
          quantity: number
          sales_unit: string
          unit_price?: number
          vat_rate?: number
        }
        Update: {
          created_at?: string
          delivery_note_id?: string
          discount_percent?: number
          id?: string
          line_number?: number
          line_subtotal_excl_vat?: number
          line_total_incl_vat?: number
          line_vat?: number
          merknad?: Json | null
          notes?: string | null
          order_id?: string | null
          order_line_id?: string | null
          product_id?: string
          product_snapshot?: Json
          quantity?: number
          sales_unit?: string
          unit_price?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_note_lines_delivery_note_id_fkey"
            columns: ["delivery_note_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_note_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          delivery_date: string
          details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          legal_entity_id: string
          lines_generated: number
          notes_generated: number
          orders_processed: number
          orders_skipped: number
          run_type: string
          started_at: string | null
          status: string
          tour_filter: string[] | null
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          delivery_date: string
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          legal_entity_id: string
          lines_generated?: number
          notes_generated?: number
          orders_processed?: number
          orders_skipped?: number
          run_type?: string
          started_at?: string | null
          status?: string
          tour_filter?: string[] | null
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          delivery_date?: string
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          legal_entity_id?: string
          lines_generated?: number
          notes_generated?: number
          orders_processed?: number
          orders_skipped?: number
          run_type?: string
          started_at?: string | null
          status?: string
          tour_filter?: string[] | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      delivery_notes: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          customer_snapshot: Json
          delivery_address_snapshot: Json
          delivery_date: string
          delivery_tour_id: string | null
          display_number: string
          finalized_at: string | null
          finalized_by: string | null
          generated_by_run_id: string | null
          id: string
          legal_entity_id: string
          notes: string | null
          route_label: string | null
          status: string
          subtotal_excl_vat: number
          total_incl_vat: number
          total_vat: number
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          customer_snapshot?: Json
          delivery_address_snapshot?: Json
          delivery_date: string
          delivery_tour_id?: string | null
          display_number: string
          finalized_at?: string | null
          finalized_by?: string | null
          generated_by_run_id?: string | null
          id?: string
          legal_entity_id: string
          notes?: string | null
          route_label?: string | null
          status?: string
          subtotal_excl_vat?: number
          total_incl_vat?: number
          total_vat?: number
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          customer_snapshot?: Json
          delivery_address_snapshot?: Json
          delivery_date?: string
          delivery_tour_id?: string | null
          display_number?: string
          finalized_at?: string | null
          finalized_by?: string | null
          generated_by_run_id?: string | null
          id?: string
          legal_entity_id?: string
          notes?: string | null
          route_label?: string | null
          status?: string
          subtotal_excl_vat?: number
          total_incl_vat?: number
          total_vat?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_notes_delivery_tour_id_fkey"
            columns: ["delivery_tour_id"]
            isOneToOne: false
            referencedRelation: "delivery_tours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_generated_by_run_fk"
            columns: ["generated_by_run_id"]
            isOneToOne: false
            referencedRelation: "delivery_note_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_pauses: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          legal_entity_id: string
          notes: string | null
          pause_from: string
          pause_to: string | null
          reason: string | null
          tour_filter: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          legal_entity_id: string
          notes?: string | null
          pause_from: string
          pause_to?: string | null
          reason?: string | null
          tour_filter?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          legal_entity_id?: string
          notes?: string | null
          pause_from?: string
          pause_to?: string | null
          reason?: string | null
          tour_filter?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      delivery_rules: {
        Row: {
          blackout_from: string | null
          blackout_until: string | null
          created_at: string
          created_by: string | null
          customer_group_ids: string[] | null
          customer_ids: string[] | null
          deadline_days_before: number | null
          deadline_time: string | null
          description: string | null
          id: string
          is_active: boolean
          legal_entity_id: string
          name: string
          product_group_ids: string[] | null
          product_ids: string[] | null
          rule_type: string
          specific_delivery_date: string | null
          tour_filter: string[] | null
          updated_at: string
          valid_from: string
          valid_until: string | null
          weekdays: number[] | null
        }
        Insert: {
          blackout_from?: string | null
          blackout_until?: string | null
          created_at?: string
          created_by?: string | null
          customer_group_ids?: string[] | null
          customer_ids?: string[] | null
          deadline_days_before?: number | null
          deadline_time?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          legal_entity_id: string
          name: string
          product_group_ids?: string[] | null
          product_ids?: string[] | null
          rule_type: string
          specific_delivery_date?: string | null
          tour_filter?: string[] | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
          weekdays?: number[] | null
        }
        Update: {
          blackout_from?: string | null
          blackout_until?: string | null
          created_at?: string
          created_by?: string | null
          customer_group_ids?: string[] | null
          customer_ids?: string[] | null
          deadline_days_before?: number | null
          deadline_time?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          legal_entity_id?: string
          name?: string
          product_group_ids?: string[] | null
          product_ids?: string[] | null
          rule_type?: string
          specific_delivery_date?: string | null
          tour_filter?: string[] | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_rules_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_tours: {
        Row: {
          active_friday: boolean
          active_monday: boolean
          active_saturday: boolean
          active_sunday: boolean
          active_thursday: boolean
          active_tuesday: boolean
          active_wednesday: boolean
          created_at: string
          created_by: string | null
          departure_time: string | null
          description: string | null
          display_name: string
          driver_name: string | null
          id: string
          legal_entity_id: string
          priority: number
          status: string
          time_from: string
          time_to: string
          tour_number: number
          updated_at: string
        }
        Insert: {
          active_friday?: boolean
          active_monday?: boolean
          active_saturday?: boolean
          active_sunday?: boolean
          active_thursday?: boolean
          active_tuesday?: boolean
          active_wednesday?: boolean
          created_at?: string
          created_by?: string | null
          departure_time?: string | null
          description?: string | null
          display_name: string
          driver_name?: string | null
          id?: string
          legal_entity_id: string
          priority?: number
          status?: string
          time_from: string
          time_to: string
          tour_number: number
          updated_at?: string
        }
        Update: {
          active_friday?: boolean
          active_monday?: boolean
          active_saturday?: boolean
          active_sunday?: boolean
          active_thursday?: boolean
          active_tuesday?: boolean
          active_wednesday?: boolean
          created_at?: string
          created_by?: string | null
          departure_time?: string | null
          description?: string | null
          display_name?: string
          driver_name?: string | null
          id?: string
          legal_entity_id?: string
          priority?: number
          status?: string
          time_from?: string
          time_to?: string
          tour_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_tours_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tours_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tours_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempt_count: number
          created_at: string
          error_message: string | null
          id: string
          last_attempt_at: string | null
          recipient_email: string
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          status: string
          template_key: string
          variables: Json
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          recipient_email: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          template_key: string
          variables?: Json
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          recipient_email?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          template_key?: string
          variables?: Json
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          available_variables: Json
          body_html_template: string
          body_text_template: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          subject_template: string
          template_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          available_variables?: Json
          body_html_template: string
          body_text_template?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          subject_template: string
          template_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          available_variables?: Json
          body_html_template?: string
          body_text_template?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          subject_template?: string
          template_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
      invoice_line_exclusion_patterns: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          legal_entity_id: string
          pattern_type: string
          pattern_value: string
          pattern_value_normalized: string | null
          reason: string | null
          supplier_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          legal_entity_id: string
          pattern_type: string
          pattern_value: string
          pattern_value_normalized?: string | null
          reason?: string | null
          supplier_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          legal_entity_id?: string
          pattern_type?: string
          pattern_value?: string
          pattern_value_normalized?: string | null
          reason?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_exclusion_patterns_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_exclusion_patterns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_match_suggestions: {
        Row: {
          confidence: number
          created_at: string | null
          id: string
          invoice_line_id: string
          match_reason: string | null
          rank: number
          raw_material_id: string
        }
        Insert: {
          confidence: number
          created_at?: string | null
          id?: string
          invoice_line_id: string
          match_reason?: string | null
          rank: number
          raw_material_id: string
        }
        Update: {
          confidence?: number
          created_at?: string | null
          id?: string
          invoice_line_id?: string
          match_reason?: string | null
          rank?: number
          raw_material_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_match_suggestions_invoice_line_id_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_match_suggestions_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          created_at: string | null
          description: string | null
          expected_price_per_base_unit: number | null
          id: string
          invoice_id: string
          line_number: number | null
          match_confidence: string | null
          price_per_base_unit: number | null
          price_variance_pct: number | null
          quantity: number | null
          raw_material_id: string | null
          requires_review: boolean | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_reason: string | null
          supplier_sku: string | null
          total_amount: number | null
          unit: string | null
          unit_price: number | null
          updated_at: string | null
          variance_status: string | null
          vat_rate: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          expected_price_per_base_unit?: number | null
          id?: string
          invoice_id: string
          line_number?: number | null
          match_confidence?: string | null
          price_per_base_unit?: number | null
          price_variance_pct?: number | null
          quantity?: number | null
          raw_material_id?: string | null
          requires_review?: boolean | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_reason?: string | null
          supplier_sku?: string | null
          total_amount?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          variance_status?: string | null
          vat_rate?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          expected_price_per_base_unit?: number | null
          id?: string
          invoice_id?: string
          line_number?: number | null
          match_confidence?: string | null
          price_per_base_unit?: number | null
          price_variance_pct?: number | null
          quantity?: number | null
          raw_material_id?: string | null
          requires_review?: boolean | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_reason?: string | null
          supplier_sku?: string | null
          total_amount?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string | null
          variance_status?: string | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_match_category_tolerances: {
        Row: {
          category: string
          id: string
          legal_entity_id: string
          price_tolerance_pct: number
        }
        Insert: {
          category: string
          id?: string
          legal_entity_id: string
          price_tolerance_pct: number
        }
        Update: {
          category?: string
          id?: string
          legal_entity_id?: string
          price_tolerance_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_match_category_tolerances_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_match_settings: {
        Row: {
          auto_approve_within_tolerance: boolean | null
          auto_reconcile_clean_imports: boolean
          default_price_tolerance_pct: number | null
          fuzzy_auto_match_dominance_threshold: number | null
          fuzzy_auto_match_threshold: number | null
          fuzzy_match_threshold: number | null
          legal_entity_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          auto_approve_within_tolerance?: boolean | null
          auto_reconcile_clean_imports?: boolean
          default_price_tolerance_pct?: number | null
          fuzzy_auto_match_dominance_threshold?: number | null
          fuzzy_auto_match_threshold?: number | null
          fuzzy_match_threshold?: number | null
          legal_entity_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          auto_approve_within_tolerance?: boolean | null
          auto_reconcile_clean_imports?: boolean
          default_price_tolerance_pct?: number | null
          fuzzy_auto_match_dominance_threshold?: number | null
          fuzzy_auto_match_threshold?: number | null
          fuzzy_match_threshold?: number | null
          legal_entity_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_match_settings_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: true
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string | null
          currency: string | null
          due_date: string | null
          ehf_payload: Json | null
          flag_action_type: string | null
          flag_reason: string | null
          flagged_at: string | null
          flagged_by: string | null
          id: string
          imported_at: string | null
          imported_from_tripletex_at: string | null
          invoice_date: string
          invoice_number: string
          is_credit_note: boolean
          legal_entity_id: string
          lines_source: string | null
          notes: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          source: string | null
          source_document_url: string | null
          status: string
          supplier_id: string
          total_amount: number | null
          total_vat: number | null
          tripletex_supplier_id: string | null
          tripletex_voucher_id: string | null
          tripletex_voucher_number: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          ehf_payload?: Json | null
          flag_action_type?: string | null
          flag_reason?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
          imported_at?: string | null
          imported_from_tripletex_at?: string | null
          invoice_date: string
          invoice_number: string
          is_credit_note?: boolean
          legal_entity_id: string
          lines_source?: string | null
          notes?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          source?: string | null
          source_document_url?: string | null
          status?: string
          supplier_id: string
          total_amount?: number | null
          total_vat?: number | null
          tripletex_supplier_id?: string | null
          tripletex_voucher_id?: string | null
          tripletex_voucher_number?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          ehf_payload?: Json | null
          flag_action_type?: string | null
          flag_reason?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
          imported_at?: string | null
          imported_from_tripletex_at?: string | null
          invoice_date?: string
          invoice_number?: string
          is_credit_note?: boolean
          legal_entity_id?: string
          lines_source?: string | null
          notes?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          source?: string | null
          source_document_url?: string | null
          status?: string
          supplier_id?: string
          total_amount?: number | null
          total_vat?: number | null
          tripletex_supplier_id?: string | null
          tripletex_voucher_id?: string | null
          tripletex_voucher_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      label_number_sequences: {
        Row: {
          last_number: number
          production_department_id: string
          seq_date: string
        }
        Insert: {
          last_number?: number
          production_department_id: string
          seq_date: string
        }
        Update: {
          last_number?: number
          production_department_id?: string
          seq_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_number_sequences_production_department_id_fkey"
            columns: ["production_department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      label_print_jobs: {
        Row: {
          id: string
          label_number: string
          legal_entity_id: string
          order_line_id: string | null
          printed_at: string
          printed_by: string
          printer_name: string | null
          product_id: string
          production_department_id: string
          profile_id: string | null
          quantity: number
          status: string
        }
        Insert: {
          id?: string
          label_number: string
          legal_entity_id: string
          order_line_id?: string | null
          printed_at?: string
          printed_by: string
          printer_name?: string | null
          product_id: string
          production_department_id: string
          profile_id?: string | null
          quantity: number
          status?: string
        }
        Update: {
          id?: string
          label_number?: string
          legal_entity_id?: string
          order_line_id?: string | null
          printed_at?: string
          printed_by?: string
          printer_name?: string | null
          product_id?: string
          production_department_id?: string
          profile_id?: string | null
          quantity?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_print_jobs_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_production_department_id_fkey"
            columns: ["production_department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_jobs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "label_print_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      label_print_profiles: {
        Row: {
          comment_includes: Json
          company_name: string
          company_note: string | null
          created_at: string
          created_by: string | null
          field_labels_bold: boolean
          fields: Json
          id: string
          include_field_labels: boolean
          include_route_name: boolean
          legal_entity_id: string
          lines: Json
          logo_height_mm: number | null
          logo_url: string | null
          margin_bottom_mm: number
          margin_left_mm: number
          margin_right_mm: number
          margin_top_mm: number
          name: string
          notes: string | null
          orientation: string
          paper_height_mm: number
          paper_width_mm: number
          skip_leveres_hentes_if_empty: boolean
          status: string
          updated_at: string
        }
        Insert: {
          comment_includes?: Json
          company_name: string
          company_note?: string | null
          created_at?: string
          created_by?: string | null
          field_labels_bold?: boolean
          fields?: Json
          id?: string
          include_field_labels?: boolean
          include_route_name?: boolean
          legal_entity_id: string
          lines?: Json
          logo_height_mm?: number | null
          logo_url?: string | null
          margin_bottom_mm?: number
          margin_left_mm?: number
          margin_right_mm?: number
          margin_top_mm?: number
          name: string
          notes?: string | null
          orientation?: string
          paper_height_mm?: number
          paper_width_mm?: number
          skip_leveres_hentes_if_empty?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          comment_includes?: Json
          company_name?: string
          company_note?: string | null
          created_at?: string
          created_by?: string | null
          field_labels_bold?: boolean
          fields?: Json
          id?: string
          include_field_labels?: boolean
          include_route_name?: boolean
          legal_entity_id?: string
          lines?: Json
          logo_height_mm?: number | null
          logo_url?: string | null
          margin_bottom_mm?: number
          margin_left_mm?: number
          margin_right_mm?: number
          margin_top_mm?: number
          name?: string
          notes?: string | null
          orientation?: string
          paper_height_mm?: number
          paper_width_mm?: number
          skip_leveres_hentes_if_empty?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_print_profiles_legal_entity_id_fkey"
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
          bank_name: string | null
          breadscale_default_enabled: boolean
          contact_email: string | null
          contact_person: string | null
          contact_phone: string | null
          created_at: string
          display_name: string | null
          founded_year: number | null
          gln: string | null
          gs1_prefix: string | null
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
          settings: Json
          short_code: string
          signature_color: string | null
          status: string
          support_email: string | null
          support_phone: string | null
          swift: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_name?: string | null
          breadscale_default_enabled?: boolean
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          founded_year?: number | null
          gln?: string | null
          gs1_prefix?: string | null
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
          settings?: Json
          short_code: string
          signature_color?: string | null
          status?: string
          support_email?: string | null
          support_phone?: string | null
          swift?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_name?: string | null
          breadscale_default_enabled?: boolean
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          founded_year?: number | null
          gln?: string | null
          gs1_prefix?: string | null
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
          settings?: Json
          short_code?: string
          signature_color?: string | null
          status?: string
          support_email?: string | null
          support_phone?: string | null
          swift?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      legal_entity_app_access: {
        Row: {
          app_id: string
          created_at: string
          enabled: boolean
          legal_entity_id: string
          updated_at: string
        }
        Insert: {
          app_id: string
          created_at?: string
          enabled?: boolean
          legal_entity_id: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          created_at?: string
          enabled?: boolean
          legal_entity_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_entity_app_access_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_entity_app_access_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_entity_margin_thresholds: {
        Row: {
          critical_below_pct: number
          legal_entity_id: string
          target_above_pct: number
          updated_at: string
          updated_by: string | null
          warn_on_drop_pp: number
          warn_on_price_age_days: number
          warning_below_pct: number
        }
        Insert: {
          critical_below_pct?: number
          legal_entity_id: string
          target_above_pct?: number
          updated_at?: string
          updated_by?: string | null
          warn_on_drop_pp?: number
          warn_on_price_age_days?: number
          warning_below_pct?: number
        }
        Update: {
          critical_below_pct?: number
          legal_entity_id?: string
          target_above_pct?: number
          updated_at?: string
          updated_by?: string | null
          warn_on_drop_pp?: number
          warn_on_price_age_days?: number
          warning_below_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "legal_entity_margin_thresholds_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: true
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      microsoft_oauth_tokens: {
        Row: {
          access_token_encrypted: string
          account_email: string
          created_at: string
          expires_at: string
          id: string
          last_refresh_at: string | null
          refresh_token_encrypted: string
          scope: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token_encrypted: string
          account_email: string
          created_at?: string
          expires_at: string
          id?: string
          last_refresh_at?: string | null
          refresh_token_encrypted: string
          scope: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string
          account_email?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_refresh_at?: string | null
          refresh_token_encrypted?: string
          scope?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      negotiation_items: {
        Row: {
          actual_avg_price_baseline: number | null
          actual_cost_baseline: number | null
          actual_volume_baseline: number | null
          created_at: string
          expected_annual_volume: number | null
          expected_annual_volume_unit: string | null
          id: string
          live_agreed_at: string | null
          live_agreed_by: string | null
          live_agreed_contract_months: number | null
          live_agreed_min_volume: number | null
          live_agreed_min_volume_unit: string | null
          live_agreed_package_size: number | null
          live_agreed_package_unit: string | null
          live_agreed_payment_terms_days: number | null
          live_agreed_price: number | null
          live_agreed_price_per_base_unit: number | null
          live_agreed_price_unit: string | null
          live_confirmed_at: string | null
          live_confirmed_by_supplier: boolean
          live_datasheet_path: string | null
          live_datasheet_skipped: boolean
          live_notes: string | null
          live_status: string | null
          live_supplier_note: string | null
          negotiation_id: string
          notes: string | null
          raw_material_id: string
          sort_order: number
          suggested_package_size: number | null
          suggested_package_unit: string | null
          target_price: number | null
        }
        Insert: {
          actual_avg_price_baseline?: number | null
          actual_cost_baseline?: number | null
          actual_volume_baseline?: number | null
          created_at?: string
          expected_annual_volume?: number | null
          expected_annual_volume_unit?: string | null
          id?: string
          live_agreed_at?: string | null
          live_agreed_by?: string | null
          live_agreed_contract_months?: number | null
          live_agreed_min_volume?: number | null
          live_agreed_min_volume_unit?: string | null
          live_agreed_package_size?: number | null
          live_agreed_package_unit?: string | null
          live_agreed_payment_terms_days?: number | null
          live_agreed_price?: number | null
          live_agreed_price_per_base_unit?: number | null
          live_agreed_price_unit?: string | null
          live_confirmed_at?: string | null
          live_confirmed_by_supplier?: boolean
          live_datasheet_path?: string | null
          live_datasheet_skipped?: boolean
          live_notes?: string | null
          live_status?: string | null
          live_supplier_note?: string | null
          negotiation_id: string
          notes?: string | null
          raw_material_id: string
          sort_order?: number
          suggested_package_size?: number | null
          suggested_package_unit?: string | null
          target_price?: number | null
        }
        Update: {
          actual_avg_price_baseline?: number | null
          actual_cost_baseline?: number | null
          actual_volume_baseline?: number | null
          created_at?: string
          expected_annual_volume?: number | null
          expected_annual_volume_unit?: string | null
          id?: string
          live_agreed_at?: string | null
          live_agreed_by?: string | null
          live_agreed_contract_months?: number | null
          live_agreed_min_volume?: number | null
          live_agreed_min_volume_unit?: string | null
          live_agreed_package_size?: number | null
          live_agreed_package_unit?: string | null
          live_agreed_payment_terms_days?: number | null
          live_agreed_price?: number | null
          live_agreed_price_per_base_unit?: number | null
          live_agreed_price_unit?: string | null
          live_confirmed_at?: string | null
          live_confirmed_by_supplier?: boolean
          live_datasheet_path?: string | null
          live_datasheet_skipped?: boolean
          live_notes?: string | null
          live_status?: string | null
          live_supplier_note?: string | null
          negotiation_id?: string
          notes?: string | null
          raw_material_id?: string
          sort_order?: number
          suggested_package_size?: number | null
          suggested_package_unit?: string | null
          target_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_items_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_live_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_data: Json | null
          event_type: string
          id: string
          negotiation_id: string
          negotiation_item_id: string | null
          note: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          negotiation_id: string
          negotiation_item_id?: string | null
          note?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          negotiation_id?: string
          negotiation_item_id?: string | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_live_events_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_live_events_negotiation_item_id_fkey"
            columns: ["negotiation_item_id"]
            isOneToOne: false
            referencedRelation: "negotiation_items"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_messages: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          negotiation_id: string
          payload: Json | null
          recipient_id: string | null
          user_agent: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          negotiation_id: string
          payload?: Json | null
          recipient_id?: string | null
          user_agent?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          negotiation_id?: string
          payload?: Json | null
          recipient_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_messages_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "negotiation_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_outcomes: {
        Row: {
          agreed_package_size: number | null
          agreed_package_unit: string | null
          agreed_price: number | null
          applied_to_supplier: boolean
          created_at: string
          id: string
          negotiation_id: string
          negotiation_item_id: string
          notes: string | null
          set_as_primary: boolean
          winner_recipient_id: string | null
          winner_response_id: string | null
        }
        Insert: {
          agreed_package_size?: number | null
          agreed_package_unit?: string | null
          agreed_price?: number | null
          applied_to_supplier?: boolean
          created_at?: string
          id?: string
          negotiation_id: string
          negotiation_item_id: string
          notes?: string | null
          set_as_primary?: boolean
          winner_recipient_id?: string | null
          winner_response_id?: string | null
        }
        Update: {
          agreed_package_size?: number | null
          agreed_package_unit?: string | null
          agreed_price?: number | null
          applied_to_supplier?: boolean
          created_at?: string
          id?: string
          negotiation_id?: string
          negotiation_item_id?: string
          notes?: string | null
          set_as_primary?: boolean
          winner_recipient_id?: string | null
          winner_response_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_outcomes_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_outcomes_negotiation_item_id_fkey"
            columns: ["negotiation_item_id"]
            isOneToOne: false
            referencedRelation: "negotiation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_outcomes_winner_recipient_id_fkey"
            columns: ["winner_recipient_id"]
            isOneToOne: false
            referencedRelation: "negotiation_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_outcomes_winner_response_id_fkey"
            columns: ["winner_response_id"]
            isOneToOne: false
            referencedRelation: "negotiation_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_recipients: {
        Row: {
          access_token: string
          contact_email: string | null
          contact_name: string | null
          created_at: string
          expires_at: string
          failed_attempts: number
          first_viewed_at: string | null
          id: string
          invited_at: string | null
          last_viewed_at: string | null
          locked_until: string | null
          negotiation_id: string
          password_expires_at: string | null
          password_hash: string | null
          password_set_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["negotiation_recipient_status"]
          supplier_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          expires_at?: string
          failed_attempts?: number
          first_viewed_at?: string | null
          id?: string
          invited_at?: string | null
          last_viewed_at?: string | null
          locked_until?: string | null
          negotiation_id: string
          password_expires_at?: string | null
          password_hash?: string | null
          password_set_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["negotiation_recipient_status"]
          supplier_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          expires_at?: string
          failed_attempts?: number
          first_viewed_at?: string | null
          id?: string
          invited_at?: string | null
          last_viewed_at?: string | null
          locked_until?: string | null
          negotiation_id?: string
          password_expires_at?: string | null
          password_hash?: string | null
          password_set_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["negotiation_recipient_status"]
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_recipients_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_recipients_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_responses: {
        Row: {
          contract_length_months: number | null
          created_at: string
          datasheet_url: string | null
          delivery_terms: string | null
          id: string
          min_order_unit: string | null
          min_order_volume: number | null
          negotiation_id: string
          negotiation_item_id: string
          notes: string | null
          offered_package_size: number | null
          offered_package_unit: string | null
          offered_price: number | null
          payment_terms: string | null
          recipient_id: string
          status: Database["public"]["Enums"]["negotiation_response_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          contract_length_months?: number | null
          created_at?: string
          datasheet_url?: string | null
          delivery_terms?: string | null
          id?: string
          min_order_unit?: string | null
          min_order_volume?: number | null
          negotiation_id: string
          negotiation_item_id: string
          notes?: string | null
          offered_package_size?: number | null
          offered_package_unit?: string | null
          offered_price?: number | null
          payment_terms?: string | null
          recipient_id: string
          status?: Database["public"]["Enums"]["negotiation_response_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          contract_length_months?: number | null
          created_at?: string
          datasheet_url?: string | null
          delivery_terms?: string | null
          id?: string
          min_order_unit?: string | null
          min_order_volume?: number | null
          negotiation_id?: string
          negotiation_item_id?: string
          notes?: string | null
          offered_package_size?: number | null
          offered_package_unit?: string | null
          offered_price?: number | null
          payment_terms?: string | null
          recipient_id?: string
          status?: Database["public"]["Enums"]["negotiation_response_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_responses_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_responses_negotiation_item_id_fkey"
            columns: ["negotiation_item_id"]
            isOneToOne: false
            referencedRelation: "negotiation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_responses_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "negotiation_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiations: {
        Row: {
          archived_at: string | null
          baseline_period_end: string | null
          baseline_period_start: string | null
          concluded_at: string | null
          contract_end: string | null
          contract_start: string | null
          created_at: string
          created_by: string
          id: string
          legal_entity_id: string
          live_auto_apply_on_confirm: boolean
          live_confirmation_deadline: string | null
          live_facilitator_id: string | null
          live_location_format: string | null
          live_send_reminder_after_days: number
          live_session_ended_at: string | null
          live_session_paused: boolean
          live_session_started_at: string | null
          negotiation_mode: string
          notes: string | null
          purpose: string | null
          response_deadline: string | null
          status: Database["public"]["Enums"]["negotiation_status"]
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          baseline_period_end?: string | null
          baseline_period_start?: string | null
          concluded_at?: string | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string
          created_by?: string
          id?: string
          legal_entity_id: string
          live_auto_apply_on_confirm?: boolean
          live_confirmation_deadline?: string | null
          live_facilitator_id?: string | null
          live_location_format?: string | null
          live_send_reminder_after_days?: number
          live_session_ended_at?: string | null
          live_session_paused?: boolean
          live_session_started_at?: string | null
          negotiation_mode?: string
          notes?: string | null
          purpose?: string | null
          response_deadline?: string | null
          status?: Database["public"]["Enums"]["negotiation_status"]
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          baseline_period_end?: string | null
          baseline_period_start?: string | null
          concluded_at?: string | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string
          created_by?: string
          id?: string
          legal_entity_id?: string
          live_auto_apply_on_confirm?: boolean
          live_confirmation_deadline?: string | null
          live_facilitator_id?: string | null
          live_location_format?: string | null
          live_send_reminder_after_days?: number
          live_session_ended_at?: string | null
          live_session_paused?: boolean
          live_session_started_at?: string | null
          negotiation_mode?: string
          notes?: string | null
          purpose?: string | null
          response_deadline?: string | null
          status?: Database["public"]["Enums"]["negotiation_status"]
          title?: string
          updated_at?: string
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
      order_confirmations_sent: {
        Row: {
          body_html: string
          body_text: string | null
          created_at: string
          edited_by_user: boolean
          error_message: string | null
          id: string
          language: string
          microsoft_message_id: string | null
          order_id: string
          recipient_email: string
          send_status: string
          sent_by: string | null
          sent_from: string | null
          subject: string
          ticket_id: string | null
          variables_snapshot: Json | null
        }
        Insert: {
          body_html: string
          body_text?: string | null
          created_at?: string
          edited_by_user?: boolean
          error_message?: string | null
          id?: string
          language?: string
          microsoft_message_id?: string | null
          order_id: string
          recipient_email: string
          send_status?: string
          sent_by?: string | null
          sent_from?: string | null
          subject: string
          ticket_id?: string | null
          variables_snapshot?: Json | null
        }
        Update: {
          body_html?: string
          body_text?: string | null
          created_at?: string
          edited_by_user?: boolean
          error_message?: string | null
          id?: string
          language?: string
          microsoft_message_id?: string | null
          order_id?: string
          recipient_email?: string
          send_status?: string
          sent_by?: string | null
          sent_from?: string | null
          subject?: string
          ticket_id?: string | null
          variables_snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "order_confirmations_sent_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_confirmations_sent_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          cake_config: Json | null
          created_at: string
          discount_percent: number
          id: string
          line_number: number
          line_subtotal_excl_vat: number
          line_total_incl_vat: number
          line_vat: number
          merknad: Json | null
          notes: string | null
          order_id: string
          product_id: string
          product_snapshot: Json
          quantity: number
          sales_unit: string
          unit_price: number
          unit_price_source: string | null
          unit_price_source_id: string | null
          vat_rate: number
        }
        Insert: {
          cake_config?: Json | null
          created_at?: string
          discount_percent?: number
          id?: string
          line_number: number
          line_subtotal_excl_vat: number
          line_total_incl_vat: number
          line_vat: number
          merknad?: Json | null
          notes?: string | null
          order_id: string
          product_id: string
          product_snapshot?: Json
          quantity: number
          sales_unit: string
          unit_price: number
          unit_price_source?: string | null
          unit_price_source_id?: string | null
          vat_rate: number
        }
        Update: {
          cake_config?: Json | null
          created_at?: string
          discount_percent?: number
          id?: string
          line_number?: number
          line_subtotal_excl_vat?: number
          line_total_incl_vat?: number
          line_vat?: number
          merknad?: Json | null
          notes?: string | null
          order_id?: string
          product_id?: string
          product_snapshot?: Json
          quantity?: number
          sales_unit?: string
          unit_price?: number
          unit_price_source?: string | null
          unit_price_source_id?: string | null
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: string | null
          id: string
          metadata: Json | null
          notes: string | null
          order_id: string
          to_status: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          order_id: string
          to_status: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          order_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cake_payload: Json | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          customer_notes: string | null
          customer_reference: string | null
          customer_snapshot: Json
          delivery_address_line1: string | null
          delivery_address_line2: string | null
          delivery_city: string | null
          delivery_country: string | null
          delivery_date: string
          delivery_instructions: string | null
          delivery_postal_code: string | null
          delivery_time: string | null
          delivery_tour_id: string | null
          distribution: string
          final_customer_email: string | null
          final_customer_name: string | null
          final_customer_phone: string | null
          id: string
          internal_notes: string | null
          invoice_recipient_customer_id: string | null
          invoice_recipient_snapshot: Json | null
          is_customer_order: boolean
          is_paid: boolean
          is_return: boolean
          legal_entity_id: string
          order_number: string
          order_sequence: number
          order_year: number
          ordered_at: string
          payment_mode: string | null
          picked_up_at: string | null
          picked_up_by: string | null
          pickup_location_id: string | null
          previous_status_before_hold: string | null
          production_notes: string | null
          recurring_schedule_id: string | null
          send_email_confirm: boolean
          send_sms_confirm: boolean
          source: string
          source_external_id: string | null
          source_reference: string | null
          status: string
          status_changed_at: string
          status_changed_by: string | null
          store_notes: string | null
          subtotal_excl_vat: number
          total_discount: number
          total_incl_vat: number
          total_vat: number
          updated_at: string
          use_customer_default_address: boolean
        }
        Insert: {
          cake_payload?: Json | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          customer_notes?: string | null
          customer_reference?: string | null
          customer_snapshot?: Json
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_date: string
          delivery_instructions?: string | null
          delivery_postal_code?: string | null
          delivery_time?: string | null
          delivery_tour_id?: string | null
          distribution?: string
          final_customer_email?: string | null
          final_customer_name?: string | null
          final_customer_phone?: string | null
          id?: string
          internal_notes?: string | null
          invoice_recipient_customer_id?: string | null
          invoice_recipient_snapshot?: Json | null
          is_customer_order?: boolean
          is_paid?: boolean
          is_return?: boolean
          legal_entity_id: string
          order_number: string
          order_sequence: number
          order_year: number
          ordered_at?: string
          payment_mode?: string | null
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_location_id?: string | null
          previous_status_before_hold?: string | null
          production_notes?: string | null
          recurring_schedule_id?: string | null
          send_email_confirm?: boolean
          send_sms_confirm?: boolean
          source: string
          source_external_id?: string | null
          source_reference?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          store_notes?: string | null
          subtotal_excl_vat?: number
          total_discount?: number
          total_incl_vat?: number
          total_vat?: number
          updated_at?: string
          use_customer_default_address?: boolean
        }
        Update: {
          cake_payload?: Json | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          customer_notes?: string | null
          customer_reference?: string | null
          customer_snapshot?: Json
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_date?: string
          delivery_instructions?: string | null
          delivery_postal_code?: string | null
          delivery_time?: string | null
          delivery_tour_id?: string | null
          distribution?: string
          final_customer_email?: string | null
          final_customer_name?: string | null
          final_customer_phone?: string | null
          id?: string
          internal_notes?: string | null
          invoice_recipient_customer_id?: string | null
          invoice_recipient_snapshot?: Json | null
          is_customer_order?: boolean
          is_paid?: boolean
          is_return?: boolean
          legal_entity_id?: string
          order_number?: string
          order_sequence?: number
          order_year?: number
          ordered_at?: string
          payment_mode?: string | null
          picked_up_at?: string | null
          picked_up_by?: string | null
          pickup_location_id?: string | null
          previous_status_before_hold?: string | null
          production_notes?: string | null
          recurring_schedule_id?: string | null
          send_email_confirm?: boolean
          send_sms_confirm?: boolean
          source?: string
          source_external_id?: string | null
          source_reference?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          store_notes?: string | null
          subtotal_excl_vat?: number
          total_discount?: number
          total_incl_vat?: number
          total_vat?: number
          updated_at?: string
          use_customer_default_address?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_tour_id_fkey"
            columns: ["delivery_tour_id"]
            isOneToOne: false
            referencedRelation: "delivery_tours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_invoice_recipient_customer_id_fkey"
            columns: ["invoice_recipient_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pickup_location_id_fkey"
            columns: ["pickup_location_id"]
            isOneToOne: false
            referencedRelation: "pickup_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_recurring_schedule_id_fkey"
            columns: ["recurring_schedule_id"]
            isOneToOne: false
            referencedRelation: "recurring_order_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_opening_exceptions: {
        Row: {
          closed: boolean
          created_at: string
          created_by: string | null
          date: string
          id: string
          note: string | null
          outlet_id: string
          periods: Json | null
          updated_at: string
        }
        Insert: {
          closed?: boolean
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          note?: string | null
          outlet_id: string
          periods?: Json | null
          updated_at?: string
        }
        Update: {
          closed?: boolean
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          note?: string | null
          outlet_id?: string
          periods?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlet_opening_exceptions_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
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
      packing_areas: {
        Row: {
          code: string
          created_at: string
          display_name: string
          display_order: number
          id: string
          legal_entity_id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          display_order?: number
          id?: string
          legal_entity_id: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          display_order?: number
          id?: string
          legal_entity_id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_areas_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_locations: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          country_code: string
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          has_pos: boolean
          id: string
          legal_entity_id: string
          pickup_number: number
          pos_display_name: string | null
          postal_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          has_pos?: boolean
          id?: string
          legal_entity_id: string
          pickup_number: number
          pos_display_name?: string | null
          postal_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          has_pos?: boolean
          id?: string
          legal_entity_id?: string
          pickup_number?: number
          pos_display_name?: string | null
          postal_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_locations_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          category: string
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          category: string
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          category?: string
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      pos_customers: {
        Row: {
          created_at: string
          credit_limit: number | null
          default_invoice_method: string | null
          display_name: string
          email: string | null
          id: string
          invoice_address: Json | null
          last_synced_at: string | null
          legal_entity_id: string
          notes: string | null
          org_number: string | null
          phone: string | null
          source_customer_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_limit?: number | null
          default_invoice_method?: string | null
          display_name: string
          email?: string | null
          id?: string
          invoice_address?: Json | null
          last_synced_at?: string | null
          legal_entity_id: string
          notes?: string | null
          org_number?: string | null
          phone?: string | null
          source_customer_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_limit?: number | null
          default_invoice_method?: string | null
          display_name?: string
          email?: string | null
          id?: string
          invoice_address?: Json | null
          last_synced_at?: string | null
          legal_entity_id?: string
          notes?: string | null
          org_number?: string | null
          phone?: string | null
          source_customer_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_customers_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_customers_source_customer_id_fkey"
            columns: ["source_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_function_images: {
        Row: {
          created_at: string
          created_by: string | null
          function_code: string
          id: string
          legal_entity_id: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          function_code: string
          id?: string
          legal_entity_id: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          function_code?: string
          id?: string
          legal_entity_id?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_function_images_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_journal_events: {
        Row: {
          event_hash: string
          event_time: string
          event_type: string
          id: number
          operator_id: string | null
          payload: Json
          prev_hash: string
          session_id: string | null
          terminal_id: string
          transaction_id: string | null
        }
        Insert: {
          event_hash: string
          event_time?: string
          event_type: string
          id?: number
          operator_id?: string | null
          payload?: Json
          prev_hash: string
          session_id?: string | null
          terminal_id: string
          transaction_id?: string | null
        }
        Update: {
          event_hash?: string
          event_time?: string
          event_type?: string
          id?: number
          operator_id?: string | null
          payload?: Json
          prev_hash?: string
          session_id?: string | null
          terminal_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_journal_events_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "pos_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_journal_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_journal_events_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_journal_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "pos_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_keypad_buttons: {
        Row: {
          background_color: string | null
          button_type: string
          display_label: string | null
          function_code: string | null
          grid_height: number
          grid_width: number
          grid_x: number
          grid_y: number
          hidden_in_self_service: boolean
          id: string
          image_storage_path: string | null
          image_url: string | null
          page_id: string
          product_id: string | null
          show_image: boolean | null
          target_page_id: string | null
          text_color: string | null
        }
        Insert: {
          background_color?: string | null
          button_type: string
          display_label?: string | null
          function_code?: string | null
          grid_height?: number
          grid_width?: number
          grid_x: number
          grid_y: number
          hidden_in_self_service?: boolean
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          page_id: string
          product_id?: string | null
          show_image?: boolean | null
          target_page_id?: string | null
          text_color?: string | null
        }
        Update: {
          background_color?: string | null
          button_type?: string
          display_label?: string | null
          function_code?: string | null
          grid_height?: number
          grid_width?: number
          grid_x?: number
          grid_y?: number
          hidden_in_self_service?: boolean
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          page_id?: string
          product_id?: string | null
          show_image?: boolean | null
          target_page_id?: string | null
          text_color?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_keypad_buttons_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pos_keypad_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_keypad_buttons_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_keypad_buttons_target_page_id_fkey"
            columns: ["target_page_id"]
            isOneToOne: false
            referencedRelation: "pos_keypad_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_keypad_layouts: {
        Row: {
          created_at: string
          customer_screen: Json | null
          display_name: string
          grid_cols: number
          grid_rows: number
          id: string
          is_default: boolean
          legal_entity_id: string
          show_product_image: boolean
          terminal_id: string | null
          theme: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_screen?: Json | null
          display_name: string
          grid_cols?: number
          grid_rows?: number
          id?: string
          is_default?: boolean
          legal_entity_id: string
          show_product_image?: boolean
          terminal_id?: string | null
          theme?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_screen?: Json | null
          display_name?: string
          grid_cols?: number
          grid_rows?: number
          id?: string
          is_default?: boolean
          legal_entity_id?: string
          show_product_image?: boolean
          terminal_id?: string | null
          theme?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_keypad_layouts_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_keypad_layouts_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_keypad_pages: {
        Row: {
          background_color: string | null
          icon: string | null
          id: string
          layout_id: string
          page_name: string
          sort_order: number
        }
        Insert: {
          background_color?: string | null
          icon?: string | null
          id?: string
          layout_id: string
          page_name: string
          sort_order?: number
        }
        Update: {
          background_color?: string | null
          icon?: string | null
          id?: string
          layout_id?: string
          page_name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_keypad_pages_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "pos_keypad_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_keypad_theme_presets: {
        Row: {
          created_at: string
          created_by: string | null
          customer_screen: Json | null
          description: string | null
          id: string
          legal_entity_id: string
          name: string
          theme: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_screen?: Json | null
          description?: string | null
          id?: string
          legal_entity_id: string
          name: string
          theme?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_screen?: Json | null
          description?: string | null
          id?: string
          legal_entity_id?: string
          name?: string
          theme?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_keypad_theme_presets_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_kiosk_users: {
        Row: {
          created_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pos_operator_terminals: {
        Row: {
          created_at: string
          operator_id: string
          terminal_id: string
        }
        Insert: {
          created_at?: string
          operator_id: string
          terminal_id: string
        }
        Update: {
          created_at?: string
          operator_id?: string
          terminal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_operator_terminals_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "pos_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_operator_terminals_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_operators: {
        Row: {
          created_at: string
          display_name: string
          id: string
          last_login_at: string | null
          legal_entity_id: string
          operator_code: string
          pin_hash: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          last_login_at?: string | null
          legal_entity_id: string
          operator_code: string
          pin_hash: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          last_login_at?: string | null
          legal_entity_id?: string
          operator_code?: string
          pin_hash?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_operators_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_print_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          payload: Json
          printed_at: string | null
          printer_id: string
          station_id: string | null
          status: string
          terminal_id: string | null
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          payload: Json
          printed_at?: string | null
          printer_id: string
          station_id?: string | null
          status?: string
          terminal_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          payload?: Json
          printed_at?: string | null
          printer_id?: string
          station_id?: string | null
          status?: string
          terminal_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_print_jobs_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "pos_printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_print_jobs_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "pos_print_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_print_jobs_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_print_jobs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "pos_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_print_stations: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          legal_entity_id: string
          station_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          legal_entity_id: string
          station_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          legal_entity_id?: string
          station_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_print_stations_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_printers: {
        Row: {
          brand: string
          created_at: string
          device_id: string
          display_name: string
          enabled: boolean
          id: string
          ip: string
          legal_entity_id: string
          paper_width: string
          port: number
          protocol: string
          updated_at: string
        }
        Insert: {
          brand?: string
          created_at?: string
          device_id?: string
          display_name: string
          enabled?: boolean
          id?: string
          ip: string
          legal_entity_id: string
          paper_width?: string
          port?: number
          protocol?: string
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          device_id?: string
          display_name?: string
          enabled?: boolean
          id?: string
          ip?: string
          legal_entity_id?: string
          paper_width?: string
          port?: number
          protocol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_printers_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_product_images: {
        Row: {
          id: string
          is_primary: boolean
          product_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          id?: string
          is_primary?: boolean
          product_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          id?: string
          is_primary?: boolean
          product_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sessions: {
        Row: {
          closed_at: string | null
          closing_float: number | null
          counted_cash: number | null
          expected_cash: number | null
          id: string
          opened_at: string
          opening_float: number
          operator_id: string
          session_number: number
          status: string
          terminal_id: string
        }
        Insert: {
          closed_at?: string | null
          closing_float?: number | null
          counted_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_float: number
          operator_id: string
          session_number: number
          status?: string
          terminal_id: string
        }
        Update: {
          closed_at?: string | null
          closing_float?: number | null
          counted_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_float?: number
          operator_id?: string
          session_number?: number
          status?: string
          terminal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_sessions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "pos_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sessions_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_terminal_printers: {
        Row: {
          created_at: string
          id: string
          printer_id: string
          role: string
          station_id: string | null
          terminal_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          printer_id: string
          role: string
          station_id?: string | null
          terminal_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          printer_id?: string
          role?: string
          station_id?: string | null
          terminal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_terminal_printers_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "pos_printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminal_printers_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "pos_print_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminal_printers_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_terminals: {
        Row: {
          created_at: string
          customer_screen_mode: string
          default_price_list_id: string | null
          display_name: string
          id: string
          legal_entity_id: string
          logo_url: string | null
          next_receipt_number: number
          next_session_number: number
          next_z_number: number
          outlet_id: string
          printer_config: Json
          receipt_prefix: string
          self_service_operator_id: string | null
          status: string
          terminal_code: string
          terminal_mode: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_screen_mode?: string
          default_price_list_id?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          logo_url?: string | null
          next_receipt_number?: number
          next_session_number?: number
          next_z_number?: number
          outlet_id: string
          printer_config?: Json
          receipt_prefix: string
          self_service_operator_id?: string | null
          status?: string
          terminal_code: string
          terminal_mode?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_screen_mode?: string
          default_price_list_id?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          logo_url?: string | null
          next_receipt_number?: number
          next_session_number?: number
          next_z_number?: number
          outlet_id?: string
          printer_config?: Json
          receipt_prefix?: string
          self_service_operator_id?: string | null
          status?: string
          terminal_code?: string
          terminal_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_terminals_default_price_list_id_fkey"
            columns: ["default_price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminals_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "pickup_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminals_self_service_operator_id_fkey"
            columns: ["self_service_operator_id"]
            isOneToOne: false
            referencedRelation: "pos_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_transaction_lines: {
        Row: {
          dining_mode_override: string | null
          id: string
          line_discount: number
          line_mva: number
          line_number: number
          line_subtotal_excl_mva: number
          line_total_incl_mva: number
          mva_rate: number
          product_id: string | null
          product_snapshot: Json
          quantity: number
          transaction_id: string
          unit_price_excl_mva: number
        }
        Insert: {
          dining_mode_override?: string | null
          id?: string
          line_discount?: number
          line_mva: number
          line_number: number
          line_subtotal_excl_mva: number
          line_total_incl_mva: number
          mva_rate: number
          product_id?: string | null
          product_snapshot: Json
          quantity: number
          transaction_id: string
          unit_price_excl_mva: number
        }
        Update: {
          dining_mode_override?: string | null
          id?: string
          line_discount?: number
          line_mva?: number
          line_number?: number
          line_subtotal_excl_mva?: number
          line_total_incl_mva?: number
          mva_rate?: number
          product_id?: string | null
          product_snapshot?: Json
          quantity?: number
          transaction_id?: string
          unit_price_excl_mva?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_transaction_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_transaction_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "pos_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_transactions: {
        Row: {
          created_at: string
          customer_id: string | null
          dining_mode: string
          id: string
          is_training: boolean
          mva_breakdown: Json
          operator_id: string
          payment_summary: Json
          receipt_number: string
          receipt_sequence: number
          reference_transaction_id: string | null
          session_id: string
          subtotal_excl_mva: number
          terminal_id: string
          total_incl_mva: number
          total_mva: number
          transaction_type: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          dining_mode?: string
          id?: string
          is_training?: boolean
          mva_breakdown: Json
          operator_id: string
          payment_summary: Json
          receipt_number: string
          receipt_sequence: number
          reference_transaction_id?: string | null
          session_id: string
          subtotal_excl_mva: number
          terminal_id: string
          total_incl_mva: number
          total_mva: number
          transaction_type: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          dining_mode?: string
          id?: string
          is_training?: boolean
          mva_breakdown?: Json
          operator_id?: string
          payment_summary?: Json
          receipt_number?: string
          receipt_sequence?: number
          reference_transaction_id?: string | null
          session_id?: string
          subtotal_excl_mva?: number
          terminal_id?: string
          total_incl_mva?: number
          total_mva?: number
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_transactions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "pos_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_transactions_reference_transaction_id_fkey"
            columns: ["reference_transaction_id"]
            isOneToOne: false
            referencedRelation: "pos_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_transactions_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_z_reports: {
        Row: {
          closed_at: string
          id: string
          last_journal_id: number
          mva_breakdown: Json
          payment_breakdown: Json
          period_end: string
          period_start: string
          refund_count: number
          refund_total: number
          report_hash: string
          terminal_id: string
          total_mva: number
          total_sales_excl_mva: number
          total_sales_incl_mva: number
          transaction_count: number
          z_number: number
        }
        Insert: {
          closed_at?: string
          id?: string
          last_journal_id: number
          mva_breakdown: Json
          payment_breakdown: Json
          period_end: string
          period_start: string
          refund_count: number
          refund_total: number
          report_hash: string
          terminal_id: string
          total_mva: number
          total_sales_excl_mva: number
          total_sales_incl_mva: number
          transaction_count: number
          z_number: number
        }
        Update: {
          closed_at?: string
          id?: string
          last_journal_id?: number
          mva_breakdown?: Json
          payment_breakdown?: Json
          period_end?: string
          period_start?: string
          refund_count?: number
          refund_total?: number
          report_hash?: string
          terminal_id?: string
          total_mva?: number
          total_sales_excl_mva?: number
          total_sales_incl_mva?: number
          transaction_count?: number
          z_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_z_reports_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      position_app_access: {
        Row: {
          app_id: string
          invoice_access: boolean
          level: Database["public"]["Enums"]["access_level"]
          position_id: string
        }
        Insert: {
          app_id: string
          invoice_access?: boolean
          level?: Database["public"]["Enums"]["access_level"]
          position_id: string
        }
        Update: {
          app_id?: string
          invoice_access?: boolean
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
          is_owner: boolean
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
          is_owner?: boolean
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
          is_owner?: boolean
          scope_pattern?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      price_list_items: {
        Row: {
          created_at: string
          id: string
          min_quantity: number | null
          price: number
          price_list_id: string
          product_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          min_quantity?: number | null
          price: number
          price_list_id: string
          product_id: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          min_quantity?: number | null
          price?: number
          price_list_id?: string
          product_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_items_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          is_default: boolean
          legal_entity_id: string
          list_number: number | null
          price_list_type: string
          prices_include_mva: boolean
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          is_default?: boolean
          legal_entity_id: string
          list_number?: number | null
          price_list_type?: string
          prices_include_mva?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          is_default?: boolean
          legal_entity_id?: string
          list_number?: number | null
          price_list_type?: string
          prices_include_mva?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      product_declaration_overrides: {
        Row: {
          field_name: string
          id: string
          override_value: Json
          product_recipe_link_id: string
          reason: string | null
          set_at: string
          set_by: string | null
        }
        Insert: {
          field_name: string
          id?: string
          override_value: Json
          product_recipe_link_id: string
          reason?: string | null
          set_at?: string
          set_by?: string | null
        }
        Update: {
          field_name?: string
          id?: string
          override_value?: Json
          product_recipe_link_id?: string
          reason?: string | null
          set_at?: string
          set_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_declaration_overrides_product_recipe_link_id_fkey"
            columns: ["product_recipe_link_id"]
            isOneToOne: false
            referencedRelation: "product_nutrition_calculated"
            referencedColumns: ["product_recipe_link_id"]
          },
          {
            foreignKeyName: "product_declaration_overrides_product_recipe_link_id_fkey"
            columns: ["product_recipe_link_id"]
            isOneToOne: false
            referencedRelation: "product_recipe_links"
            referencedColumns: ["id"]
          },
        ]
      }
      product_label_departments: {
        Row: {
          created_at: string
          department_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_label_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_label_departments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_main_categories: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          legal_entity_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_main_categories_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      product_package_items: {
        Row: {
          contained_product_id: string
          created_at: string
          id: string
          package_product_id: string
          quantity: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          contained_product_id: string
          created_at?: string
          id?: string
          package_product_id: string
          quantity?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          contained_product_id?: string
          created_at?: string
          id?: string
          package_product_id?: string
          quantity?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_package_items_contained_product_id_fkey"
            columns: ["contained_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_package_items_package_product_id_fkey"
            columns: ["package_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_packing_areas: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          notes: string | null
          packing_area_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          packing_area_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          packing_area_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_packing_areas_packing_area_id_fkey"
            columns: ["packing_area_id"]
            isOneToOne: false
            referencedRelation: "packing_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_packing_areas_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_pages: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          legal_entity_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_pages_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recipe_links: {
        Row: {
          created_at: string
          declaration_mode:
            | Database["public"]["Enums"]["declaration_mode"]
            | null
          declaration_updated_at: string | null
          declaration_updated_by: string | null
          extra_lines: Json
          extra_packaging: Json
          id: string
          is_primary: boolean
          manual_allergen_summary: Json | null
          manual_ingredient_declaration: string | null
          manual_nutrition: Json | null
          notes: string | null
          price_overrides: Json
          product_id: string
          recipe_id: string
          units_per_batch_override: number | null
          updated_at: string
          yield_weight_g_override: number | null
        }
        Insert: {
          created_at?: string
          declaration_mode?:
            | Database["public"]["Enums"]["declaration_mode"]
            | null
          declaration_updated_at?: string | null
          declaration_updated_by?: string | null
          extra_lines?: Json
          extra_packaging?: Json
          id?: string
          is_primary?: boolean
          manual_allergen_summary?: Json | null
          manual_ingredient_declaration?: string | null
          manual_nutrition?: Json | null
          notes?: string | null
          price_overrides?: Json
          product_id: string
          recipe_id: string
          units_per_batch_override?: number | null
          updated_at?: string
          yield_weight_g_override?: number | null
        }
        Update: {
          created_at?: string
          declaration_mode?:
            | Database["public"]["Enums"]["declaration_mode"]
            | null
          declaration_updated_at?: string | null
          declaration_updated_by?: string | null
          extra_lines?: Json
          extra_packaging?: Json
          id?: string
          is_primary?: boolean
          manual_allergen_summary?: Json | null
          manual_ingredient_declaration?: string | null
          manual_nutrition?: Json | null
          notes?: string | null
          price_overrides?: Json
          product_id?: string
          recipe_id?: string
          units_per_batch_override?: number | null
          updated_at?: string
          yield_weight_g_override?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_recipe_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipe_links_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition_calculated"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "product_recipe_links_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      product_return_price_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          override_type: string
          override_value: number
          price_list_id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          override_type: string
          override_value: number
          price_list_id: string
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          override_type?: string
          override_value?: number
          price_list_id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_return_price_overrides_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_return_price_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sales_groups: {
        Row: {
          created_at: string
          product_id: string
          sales_group_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          sales_group_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          sales_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_sales_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sales_groups_sales_group_id_fkey"
            columns: ["sales_group_id"]
            isOneToOne: false
            referencedRelation: "sales_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sub_categories: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          legal_entity_id: string
          main_category_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          main_category_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          main_category_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_sub_categories_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sub_categories_main_category_id_fkey"
            columns: ["main_category_id"]
            isOneToOne: false
            referencedRelation: "product_main_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      production_criteria_templates: {
        Row: {
          category_code: string | null
          created_at: string
          created_by: string | null
          criteria: Json
          id: string
          legal_entity_id: string
          name: string
          updated_at: string
        }
        Insert: {
          category_code?: string | null
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          legal_entity_id: string
          name: string
          updated_at?: string
        }
        Update: {
          category_code?: string | null
          created_at?: string
          created_by?: string | null
          criteria?: Json
          id?: string
          legal_entity_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_criteria_templates_category_code_fkey"
            columns: ["category_code"]
            isOneToOne: false
            referencedRelation: "production_template_categories"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "production_criteria_templates_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      production_departments: {
        Row: {
          code: string
          created_at: string
          display_name: string
          id: string
          legal_entity_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          id?: string
          legal_entity_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          id?: string
          legal_entity_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_departments_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      production_groups: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          legal_entity_id: string
          main_product_id: string | null
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          main_product_id?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          main_product_id?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_groups_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_groups_main_product_id_fkey"
            columns: ["main_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_plan_snapshot_items: {
        Row: {
          id: string
          product_id: string
          quantity_from_stock: number
          quantity_ordered: number
          quantity_to_produce: number
          row_key: string
          snapshot_id: string
          trays_full: number
          trays_partial: number
        }
        Insert: {
          id?: string
          product_id: string
          quantity_from_stock?: number
          quantity_ordered?: number
          quantity_to_produce?: number
          row_key?: string
          snapshot_id: string
          trays_full?: number
          trays_partial?: number
        }
        Update: {
          id?: string
          product_id?: string
          quantity_from_stock?: number
          quantity_ordered?: number
          quantity_to_produce?: number
          row_key?: string
          snapshot_id?: string
          trays_full?: number
          trays_partial?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_plan_snapshot_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_plan_snapshot_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "production_plan_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      production_plan_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          criteria_copy: Json
          id: string
          legal_entity_id: string
          list_type: string
          note: string | null
          production_date: string
          template_id: string | null
          template_name_copy: string | null
          tours: number[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          criteria_copy?: Json
          id?: string
          legal_entity_id: string
          list_type?: string
          note?: string | null
          production_date: string
          template_id?: string | null
          template_name_copy?: string | null
          tours?: number[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          criteria_copy?: Json
          id?: string
          legal_entity_id?: string
          list_type?: string
          note?: string | null
          production_date?: string
          template_id?: string | null
          template_name_copy?: string | null
          tours?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "production_plan_snapshots_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_plan_snapshots_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "production_criteria_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      production_template_categories: {
        Row: {
          code: string
          color_hex: string
          created_at: string
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          color_hex?: string
          created_at?: string
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          color_hex?: string
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          account_reference: string | null
          allows_return: boolean
          breadscale_value: number | null
          cake_role: string | null
          cert_nokkelhull: boolean
          cert_norsk_100: boolean
          code: string
          created_at: string
          created_by: string | null
          datasheet_url: string | null
          declaration_needs_review: boolean
          declaration_review_reason: string | null
          description: string | null
          description_rich: Json | null
          display_name: string
          display_number: number
          dough_type: string | null
          ean_code: string | null
          energy_cost_per_unit: number
          epd_number: string | null
          gtin: string | null
          id: string
          image_url: string | null
          in_pos: boolean
          in_web_shop: boolean
          include_in_price_lists: boolean
          internal_sku: string | null
          is_cake_component: boolean
          is_divisible: boolean
          is_for_sale: boolean
          is_package: boolean
          is_production_group_main: boolean
          is_warehouse_item: boolean
          keywords: string[] | null
          label_mode: string
          label_print_model: string
          label_profile_id: string | null
          labor_cost_per_unit: number
          lead_time_days: number | null
          legal_entity_id: string
          main_category_id: string | null
          manual_allergens_contains: string[]
          manual_allergens_may_contain: string[]
          manual_declaration_updated_at: string | null
          manual_declaration_updated_by: string | null
          manual_ingredient_declaration: string | null
          manual_nutrition_per_100g: Json | null
          mva_always_included: boolean
          mva_rate: number
          packaging_cost_per_unit: number
          pause_delivery_from: string | null
          pause_delivery_to: string | null
          pause_reason: string | null
          pause_reason_customer: string | null
          pieces_per_liter: number | null
          pieces_per_tray: number | null
          pieces_per_unit: number | null
          pos_display_name: string | null
          pos_print_station_id: string | null
          print_declaration_labels: boolean
          product_category: string
          product_page_id: string | null
          product_subcategory: string | null
          production_buffer: number | null
          production_group_id: string | null
          return_price_type: string | null
          return_value: number | null
          shelf_life_chilled_days: number | null
          shelf_life_frozen_days: number | null
          show_breadscale: boolean | null
          statistics_group: string | null
          status: string
          sub_category_id: string | null
          unit_of_sale: string
          updated_at: string
          variant_label: string | null
          variant_of_product_id: string | null
          weight_per_unit_grams: number | null
        }
        Insert: {
          account_reference?: string | null
          allows_return?: boolean
          breadscale_value?: number | null
          cake_role?: string | null
          cert_nokkelhull?: boolean
          cert_norsk_100?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          datasheet_url?: string | null
          declaration_needs_review?: boolean
          declaration_review_reason?: string | null
          description?: string | null
          description_rich?: Json | null
          display_name: string
          display_number: number
          dough_type?: string | null
          ean_code?: string | null
          energy_cost_per_unit?: number
          epd_number?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          in_pos?: boolean
          in_web_shop?: boolean
          include_in_price_lists?: boolean
          internal_sku?: string | null
          is_cake_component?: boolean
          is_divisible?: boolean
          is_for_sale?: boolean
          is_package?: boolean
          is_production_group_main?: boolean
          is_warehouse_item?: boolean
          keywords?: string[] | null
          label_mode?: string
          label_print_model?: string
          label_profile_id?: string | null
          labor_cost_per_unit?: number
          lead_time_days?: number | null
          legal_entity_id: string
          main_category_id?: string | null
          manual_allergens_contains?: string[]
          manual_allergens_may_contain?: string[]
          manual_declaration_updated_at?: string | null
          manual_declaration_updated_by?: string | null
          manual_ingredient_declaration?: string | null
          manual_nutrition_per_100g?: Json | null
          mva_always_included?: boolean
          mva_rate?: number
          packaging_cost_per_unit?: number
          pause_delivery_from?: string | null
          pause_delivery_to?: string | null
          pause_reason?: string | null
          pause_reason_customer?: string | null
          pieces_per_liter?: number | null
          pieces_per_tray?: number | null
          pieces_per_unit?: number | null
          pos_display_name?: string | null
          pos_print_station_id?: string | null
          print_declaration_labels?: boolean
          product_category: string
          product_page_id?: string | null
          product_subcategory?: string | null
          production_buffer?: number | null
          production_group_id?: string | null
          return_price_type?: string | null
          return_value?: number | null
          shelf_life_chilled_days?: number | null
          shelf_life_frozen_days?: number | null
          show_breadscale?: boolean | null
          statistics_group?: string | null
          status?: string
          sub_category_id?: string | null
          unit_of_sale?: string
          updated_at?: string
          variant_label?: string | null
          variant_of_product_id?: string | null
          weight_per_unit_grams?: number | null
        }
        Update: {
          account_reference?: string | null
          allows_return?: boolean
          breadscale_value?: number | null
          cake_role?: string | null
          cert_nokkelhull?: boolean
          cert_norsk_100?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          datasheet_url?: string | null
          declaration_needs_review?: boolean
          declaration_review_reason?: string | null
          description?: string | null
          description_rich?: Json | null
          display_name?: string
          display_number?: number
          dough_type?: string | null
          ean_code?: string | null
          energy_cost_per_unit?: number
          epd_number?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          in_pos?: boolean
          in_web_shop?: boolean
          include_in_price_lists?: boolean
          internal_sku?: string | null
          is_cake_component?: boolean
          is_divisible?: boolean
          is_for_sale?: boolean
          is_package?: boolean
          is_production_group_main?: boolean
          is_warehouse_item?: boolean
          keywords?: string[] | null
          label_mode?: string
          label_print_model?: string
          label_profile_id?: string | null
          labor_cost_per_unit?: number
          lead_time_days?: number | null
          legal_entity_id?: string
          main_category_id?: string | null
          manual_allergens_contains?: string[]
          manual_allergens_may_contain?: string[]
          manual_declaration_updated_at?: string | null
          manual_declaration_updated_by?: string | null
          manual_ingredient_declaration?: string | null
          manual_nutrition_per_100g?: Json | null
          mva_always_included?: boolean
          mva_rate?: number
          packaging_cost_per_unit?: number
          pause_delivery_from?: string | null
          pause_delivery_to?: string | null
          pause_reason?: string | null
          pause_reason_customer?: string | null
          pieces_per_liter?: number | null
          pieces_per_tray?: number | null
          pieces_per_unit?: number | null
          pos_display_name?: string | null
          pos_print_station_id?: string | null
          print_declaration_labels?: boolean
          product_category?: string
          product_page_id?: string | null
          product_subcategory?: string | null
          production_buffer?: number | null
          production_group_id?: string | null
          return_price_type?: string | null
          return_value?: number | null
          shelf_life_chilled_days?: number | null
          shelf_life_frozen_days?: number | null
          show_breadscale?: boolean | null
          statistics_group?: string | null
          status?: string
          sub_category_id?: string | null
          unit_of_sale?: string
          updated_at?: string
          variant_label?: string | null
          variant_of_product_id?: string | null
          weight_per_unit_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_label_profile_id_fkey"
            columns: ["label_profile_id"]
            isOneToOne: false
            referencedRelation: "label_print_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_main_category_id_fkey"
            columns: ["main_category_id"]
            isOneToOne: false
            referencedRelation: "product_main_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_pos_print_station_id_fkey"
            columns: ["pos_print_station_id"]
            isOneToOne: false
            referencedRelation: "pos_print_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_product_page_id_fkey"
            columns: ["product_page_id"]
            isOneToOne: false
            referencedRelation: "product_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_production_group_id_fkey"
            columns: ["production_group_id"]
            isOneToOne: false
            referencedRelation: "production_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_sub_category_id_fkey"
            columns: ["sub_category_id"]
            isOneToOne: false
            referencedRelation: "product_sub_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_variant_of_product_id_fkey"
            columns: ["variant_of_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_allergens: {
        Row: {
          allergen: Database["public"]["Enums"]["allergen_type"]
          id: string
          presence: Database["public"]["Enums"]["allergen_presence"]
          raw_material_id: string
        }
        Insert: {
          allergen: Database["public"]["Enums"]["allergen_type"]
          id?: string
          presence?: Database["public"]["Enums"]["allergen_presence"]
          raw_material_id: string
        }
        Update: {
          allergen?: Database["public"]["Enums"]["allergen_type"]
          id?: string
          presence?: Database["public"]["Enums"]["allergen_presence"]
          raw_material_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_allergens_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_changelog: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          affected_recipes_count: number
          change_type: string
          created_at: string
          created_by: string | null
          datasheet_id: string | null
          field: string | null
          id: string
          legal_entity_id: string
          new_value: Json | null
          old_value: Json | null
          raw_material_id: string
          severity: string
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          affected_recipes_count?: number
          change_type: string
          created_at?: string
          created_by?: string | null
          datasheet_id?: string | null
          field?: string | null
          id?: string
          legal_entity_id: string
          new_value?: Json | null
          old_value?: Json | null
          raw_material_id: string
          severity?: string
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          affected_recipes_count?: number
          change_type?: string
          created_at?: string
          created_by?: string | null
          datasheet_id?: string | null
          field?: string | null
          id?: string
          legal_entity_id?: string
          new_value?: Json | null
          old_value?: Json | null
          raw_material_id?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_changelog_datasheet_id_fkey"
            columns: ["datasheet_id"]
            isOneToOne: false
            referencedRelation: "raw_material_datasheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_changelog_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_components: {
        Row: {
          allergens: Database["public"]["Enums"]["allergen_type"][] | null
          component_raw_material_id: string | null
          created_at: string
          id: string
          is_explicit_percentage: boolean
          is_quid_relevant: boolean
          needs_review: boolean
          parent_raw_material_id: string
          percentage: number
          primary_ingredient_name: string | null
          sort_order: number
          suggested_by_ai: boolean
        }
        Insert: {
          allergens?: Database["public"]["Enums"]["allergen_type"][] | null
          component_raw_material_id?: string | null
          created_at?: string
          id?: string
          is_explicit_percentage?: boolean
          is_quid_relevant?: boolean
          needs_review?: boolean
          parent_raw_material_id: string
          percentage: number
          primary_ingredient_name?: string | null
          sort_order?: number
          suggested_by_ai?: boolean
        }
        Update: {
          allergens?: Database["public"]["Enums"]["allergen_type"][] | null
          component_raw_material_id?: string | null
          created_at?: string
          id?: string
          is_explicit_percentage?: boolean
          is_quid_relevant?: boolean
          needs_review?: boolean
          parent_raw_material_id?: string
          percentage?: number
          primary_ingredient_name?: string | null
          sort_order?: number
          suggested_by_ai?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_components_component_raw_material_id_fkey"
            columns: ["component_raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_components_parent_raw_material_id_fkey"
            columns: ["parent_raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_datasheets: {
        Row: {
          ai_confidence: number | null
          ai_extracted: Json | null
          ai_model: string | null
          batch_id: string | null
          file_hash: string | null
          file_name: string | null
          file_path: string
          id: string
          is_current: boolean
          legal_entity_id: string
          package_size_unit: string | null
          package_size_value: number | null
          raw_ai_response: Json | null
          raw_material_id: string | null
          replaced_by: string | null
          sku: string | null
          status: string
          supplier_name: string | null
          uploaded_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          ai_confidence?: number | null
          ai_extracted?: Json | null
          ai_model?: string | null
          batch_id?: string | null
          file_hash?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          is_current?: boolean
          legal_entity_id: string
          package_size_unit?: string | null
          package_size_value?: number | null
          raw_ai_response?: Json | null
          raw_material_id?: string | null
          replaced_by?: string | null
          sku?: string | null
          status?: string
          supplier_name?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          ai_confidence?: number | null
          ai_extracted?: Json | null
          ai_model?: string | null
          batch_id?: string | null
          file_hash?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          is_current?: boolean
          legal_entity_id?: string
          package_size_unit?: string | null
          package_size_value?: number | null
          raw_ai_response?: Json | null
          raw_material_id?: string | null
          replaced_by?: string | null
          sku?: string | null
          status?: string
          supplier_name?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_datasheets_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "datasheet_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_datasheets_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rmd_replaced_by_fk"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "raw_material_datasheets"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_nutrition: {
        Row: {
          carbs_g: number | null
          country_of_origin: string | null
          e_numbers: string[] | null
          energy_kcal: number | null
          energy_kj: number | null
          fat_g: number | null
          fiber_g: number | null
          ingredient_declaration: string | null
          protein_g: number | null
          raw_material_id: string
          salt_g: number | null
          saturated_fat_g: number | null
          source: string | null
          source_document_url: string | null
          sugars_g: number | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          carbs_g?: number | null
          country_of_origin?: string | null
          e_numbers?: string[] | null
          energy_kcal?: number | null
          energy_kj?: number | null
          fat_g?: number | null
          fiber_g?: number | null
          ingredient_declaration?: string | null
          protein_g?: number | null
          raw_material_id: string
          salt_g?: number | null
          saturated_fat_g?: number | null
          source?: string | null
          source_document_url?: string | null
          sugars_g?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          carbs_g?: number | null
          country_of_origin?: string | null
          e_numbers?: string[] | null
          energy_kcal?: number | null
          energy_kj?: number | null
          fat_g?: number | null
          fiber_g?: number | null
          ingredient_declaration?: string | null
          protein_g?: number | null
          raw_material_id?: string
          salt_g?: number | null
          saturated_fat_g?: number | null
          source?: string | null
          source_document_url?: string | null
          sugars_g?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_nutrition_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: true
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_price_history: {
        Row: {
          created_at: string
          created_by: string | null
          effective_date: string
          id: string
          invoice_id: string | null
          notes: string | null
          price: number
          raw_material_id: string
          source: string
          source_reference: string | null
          supplier_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_date: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          price: number
          raw_material_id: string
          source: string
          source_reference?: string | null
          supplier_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_date?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          price?: number
          raw_material_id?: string
          source?: string
          source_reference?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_price_history_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_price_history_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_purchases: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          invoice_line_id: string
          legal_entity_id: string
          price_per_base_unit: number | null
          purchase_date: string
          quantity: number
          raw_material_id: string
          supplier_id: string
          total_amount: number | null
          unit: string | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          invoice_line_id: string
          legal_entity_id: string
          price_per_base_unit?: number | null
          purchase_date: string
          quantity: number
          raw_material_id: string
          supplier_id: string
          total_amount?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          invoice_line_id?: string
          legal_entity_id?: string
          price_per_base_unit?: number | null
          purchase_date?: string
          quantity?: number
          raw_material_id?: string
          supplier_id?: string
          total_amount?: number | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_purchases_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_purchases_invoice_line_id_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: true
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_purchases_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_supplier_aliases: {
        Row: {
          alias_type: Database["public"]["Enums"]["alias_type"]
          alias_value: string
          alias_value_normalized: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          first_seen_invoice_id: string | null
          id: string
          last_seen_at: string
          match_count: number
          raw_material_supplier_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejected_reason: string | null
          status: Database["public"]["Enums"]["alias_status"]
        }
        Insert: {
          alias_type: Database["public"]["Enums"]["alias_type"]
          alias_value: string
          alias_value_normalized?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          first_seen_invoice_id?: string | null
          id?: string
          last_seen_at?: string
          match_count?: number
          raw_material_supplier_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["alias_status"]
        }
        Update: {
          alias_type?: Database["public"]["Enums"]["alias_type"]
          alias_value?: string
          alias_value_normalized?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          first_seen_invoice_id?: string | null
          id?: string
          last_seen_at?: string
          match_count?: number
          raw_material_supplier_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_supplier_aliases_raw_material_supplier_id_fkey"
            columns: ["raw_material_supplier_id"]
            isOneToOne: false
            referencedRelation: "raw_material_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_suppliers: {
        Row: {
          agreed_price: number | null
          agreed_price_per_base_unit: number | null
          agreement_document_url: string | null
          agreement_valid_from: string | null
          agreement_valid_to: string | null
          created_at: string
          id: string
          is_primary: boolean
          last_invoice_date: string | null
          last_invoice_price: number | null
          notes: string | null
          package_size: number | null
          package_unit: string | null
          raw_material_id: string
          supplier_id: string
          supplier_product_name: string | null
          supplier_sku: string | null
          updated_at: string
        }
        Insert: {
          agreed_price?: number | null
          agreed_price_per_base_unit?: number | null
          agreement_document_url?: string | null
          agreement_valid_from?: string | null
          agreement_valid_to?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          last_invoice_date?: string | null
          last_invoice_price?: number | null
          notes?: string | null
          package_size?: number | null
          package_unit?: string | null
          raw_material_id: string
          supplier_id: string
          supplier_product_name?: string | null
          supplier_sku?: string | null
          updated_at?: string
        }
        Update: {
          agreed_price?: number | null
          agreed_price_per_base_unit?: number | null
          agreement_document_url?: string | null
          agreement_valid_from?: string | null
          agreement_valid_to?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          last_invoice_date?: string | null
          last_invoice_price?: number | null
          notes?: string | null
          package_size?: number | null
          package_unit?: string | null
          raw_material_id?: string
          supplier_id?: string
          supplier_product_name?: string | null
          supplier_sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_suppliers_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_materials: {
        Row: {
          agreed_price: number | null
          base_unit: string
          categories: string[]
          category: string | null
          components_reviewed_at: string | null
          created_at: string
          created_by: string | null
          current_cost_price: number | null
          current_stock: number
          description: string | null
          grain_classification: string | null
          id: string
          is_active: boolean
          is_composite: boolean
          is_packaging: boolean
          legal_entity_id: string
          min_stock: number | null
          name: string
          package_size: number | null
          package_unit: string | null
          price_source: string | null
          price_updated_at: string | null
          primary_supplier_id: string | null
          sku: string
          unit_weight_grams: number | null
          updated_at: string
        }
        Insert: {
          agreed_price?: number | null
          base_unit: string
          categories?: string[]
          category?: string | null
          components_reviewed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_cost_price?: number | null
          current_stock?: number
          description?: string | null
          grain_classification?: string | null
          id?: string
          is_active?: boolean
          is_composite?: boolean
          is_packaging?: boolean
          legal_entity_id: string
          min_stock?: number | null
          name: string
          package_size?: number | null
          package_unit?: string | null
          price_source?: string | null
          price_updated_at?: string | null
          primary_supplier_id?: string | null
          sku: string
          unit_weight_grams?: number | null
          updated_at?: string
        }
        Update: {
          agreed_price?: number | null
          base_unit?: string
          categories?: string[]
          category?: string | null
          components_reviewed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_cost_price?: number | null
          current_stock?: number
          description?: string | null
          grain_classification?: string | null
          id?: string
          is_active?: boolean
          is_composite?: boolean
          is_packaging?: boolean
          legal_entity_id?: string
          min_stock?: number | null
          name?: string
          package_size?: number | null
          package_unit?: string | null
          price_source?: string | null
          price_updated_at?: string | null
          primary_supplier_id?: string | null
          sku?: string
          unit_weight_grams?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_materials_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_materials_primary_supplier_id_fkey"
            columns: ["primary_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_grain_score: {
        Row: {
          category: string | null
          classification_complete: boolean | null
          coarse_grams_weighted: number | null
          computed_at: string
          grain_score_pct: number | null
          product_recipe_link_id: string
          total_flour_grams: number | null
          unclassified_count: number
          unclassified_names: string[] | null
        }
        Insert: {
          category?: string | null
          classification_complete?: boolean | null
          coarse_grams_weighted?: number | null
          computed_at?: string
          grain_score_pct?: number | null
          product_recipe_link_id: string
          total_flour_grams?: number | null
          unclassified_count?: number
          unclassified_names?: string[] | null
        }
        Update: {
          category?: string | null
          classification_complete?: boolean | null
          coarse_grams_weighted?: number | null
          computed_at?: string
          grain_score_pct?: number | null
          product_recipe_link_id?: string
          total_flour_grams?: number | null
          unclassified_count?: number
          unclassified_names?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_grain_score_product_recipe_link_id_fkey"
            columns: ["product_recipe_link_id"]
            isOneToOne: true
            referencedRelation: "product_nutrition_calculated"
            referencedColumns: ["product_recipe_link_id"]
          },
          {
            foreignKeyName: "recipe_grain_score_product_recipe_link_id_fkey"
            columns: ["product_recipe_link_id"]
            isOneToOne: true
            referencedRelation: "product_recipe_links"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_labor_lines: {
        Row: {
          created_at: string
          hourly_rate: number | null
          hours: number
          id: string
          labor_type: string
          recipe_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          hourly_rate?: number | null
          hours?: number
          id?: string
          labor_type: string
          recipe_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          hourly_rate?: number | null
          hours?: number
          id?: string
          labor_type?: string
          recipe_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_labor_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition_calculated"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_labor_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_lines: {
        Row: {
          created_at: string
          custom_declaration_text: string | null
          id: string
          include_in_declaration: boolean
          ingredient_id: string | null
          ingredient_name: string | null
          is_quid_relevant: boolean
          notes: string | null
          quantity: number
          quantity_grams: number | null
          raw_material_id: string | null
          recipe_id: string
          recipe_part_id: string
          sort_order: number
          unit: string
          updated_at: string
          waste_percent: number | null
        }
        Insert: {
          created_at?: string
          custom_declaration_text?: string | null
          id?: string
          include_in_declaration?: boolean
          ingredient_id?: string | null
          ingredient_name?: string | null
          is_quid_relevant?: boolean
          notes?: string | null
          quantity: number
          quantity_grams?: number | null
          raw_material_id?: string | null
          recipe_id: string
          recipe_part_id: string
          sort_order?: number
          unit: string
          updated_at?: string
          waste_percent?: number | null
        }
        Update: {
          created_at?: string
          custom_declaration_text?: string | null
          id?: string
          include_in_declaration?: boolean
          ingredient_id?: string | null
          ingredient_name?: string | null
          is_quid_relevant?: boolean
          notes?: string | null
          quantity?: number
          quantity_grams?: number | null
          raw_material_id?: string | null
          recipe_id?: string
          recipe_part_id?: string
          sort_order?: number
          unit?: string
          updated_at?: string
          waste_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_lines_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition_calculated"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_recipe_part_id_fkey"
            columns: ["recipe_part_id"]
            isOneToOne: false
            referencedRelation: "recipe_parts"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_packaging_lines: {
        Row: {
          created_at: string
          id: string
          name: string | null
          quantity: number
          raw_material_id: string | null
          recipe_id: string
          sort_order: number
          unit_price_override: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          quantity?: number
          raw_material_id?: string | null
          recipe_id: string
          sort_order?: number
          unit_price_override?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          quantity?: number
          raw_material_id?: string | null
          recipe_id?: string
          sort_order?: number
          unit_price_override?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_packaging_lines_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_packaging_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition_calculated"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_packaging_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_parts: {
        Row: {
          created_at: string
          id: string
          instructions: string | null
          name: string
          prep_time_minutes: number | null
          recipe_id: string
          rest_time_minutes: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          instructions?: string | null
          name: string
          prep_time_minutes?: number | null
          recipe_id: string
          rest_time_minutes?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          instructions?: string | null
          name?: string
          prep_time_minutes?: number | null
          recipe_id?: string
          rest_time_minutes?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_parts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_nutrition_calculated"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_parts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          bake_temp_celsius: number | null
          bake_time_minutes: number | null
          bulk_proof_minutes: number | null
          cooling_minutes: number | null
          created_at: string
          created_by: string | null
          declaration_mode: Database["public"]["Enums"]["declaration_mode"]
          declaration_updated_at: string | null
          declaration_updated_by: string | null
          hourly_rate: number
          id: string
          legal_entity_id: string | null
          manual_allergen_summary: Json | null
          manual_ingredient_declaration: string | null
          manual_nutrition: Json | null
          name: string | null
          notes: string | null
          price_egne_utsalg: number | null
          price_engros: number | null
          price_engros_with_packaging: number | null
          price_netto: number | null
          product_id: string | null
          production_notes: string | null
          requires_cleanup: boolean
          shape_proof_minutes: number | null
          steam_seconds: number | null
          target_db_pct: number
          units_per_batch: number | null
          updated_at: string
          valid_from: string
          valid_to: string | null
          version: number
          yield_grams: number | null
          yield_loss_pct: number
          yield_quantity: number
          yield_unit: string
        }
        Insert: {
          bake_temp_celsius?: number | null
          bake_time_minutes?: number | null
          bulk_proof_minutes?: number | null
          cooling_minutes?: number | null
          created_at?: string
          created_by?: string | null
          declaration_mode?: Database["public"]["Enums"]["declaration_mode"]
          declaration_updated_at?: string | null
          declaration_updated_by?: string | null
          hourly_rate?: number
          id?: string
          legal_entity_id?: string | null
          manual_allergen_summary?: Json | null
          manual_ingredient_declaration?: string | null
          manual_nutrition?: Json | null
          name?: string | null
          notes?: string | null
          price_egne_utsalg?: number | null
          price_engros?: number | null
          price_engros_with_packaging?: number | null
          price_netto?: number | null
          product_id?: string | null
          production_notes?: string | null
          requires_cleanup?: boolean
          shape_proof_minutes?: number | null
          steam_seconds?: number | null
          target_db_pct?: number
          units_per_batch?: number | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          version?: number
          yield_grams?: number | null
          yield_loss_pct?: number
          yield_quantity?: number
          yield_unit?: string
        }
        Update: {
          bake_temp_celsius?: number | null
          bake_time_minutes?: number | null
          bulk_proof_minutes?: number | null
          cooling_minutes?: number | null
          created_at?: string
          created_by?: string | null
          declaration_mode?: Database["public"]["Enums"]["declaration_mode"]
          declaration_updated_at?: string | null
          declaration_updated_by?: string | null
          hourly_rate?: number
          id?: string
          legal_entity_id?: string | null
          manual_allergen_summary?: Json | null
          manual_ingredient_declaration?: string | null
          manual_nutrition?: Json | null
          name?: string | null
          notes?: string | null
          price_egne_utsalg?: number | null
          price_engros?: number | null
          price_engros_with_packaging?: number | null
          price_netto?: number | null
          product_id?: string | null
          production_notes?: string | null
          requires_cleanup?: boolean
          shape_proof_minutes?: number | null
          steam_seconds?: number | null
          target_db_pct?: number
          units_per_batch?: number | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          version?: number
          yield_grams?: number | null
          yield_loss_pct?: number
          yield_quantity?: number
          yield_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_order_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity: number
          schedule_id: string
          tour_id: string | null
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          schedule_id: string
          tour_id?: string | null
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          schedule_id?: string
          tour_id?: string | null
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_order_items_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "recurring_order_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_order_items_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "delivery_tours"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_order_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_active: boolean
          legal_entity_id: string
          name: string
          notes: string | null
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_active?: boolean
          legal_entity_id: string
          name?: string
          notes?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_active?: boolean
          legal_entity_id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_order_schedules_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_order_schedules_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_groups: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          legal_entity_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_groups_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      special_prices: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          is_net_price: boolean
          legal_entity_id: string
          notes: string | null
          precedence_over_weekday: boolean
          price: number
          price_list_id: string | null
          product_id: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
          weekday: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          is_net_price?: boolean
          legal_entity_id: string
          notes?: string | null
          precedence_over_weekday?: boolean
          price: number
          price_list_id?: string | null
          product_id: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          weekday?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          is_net_price?: boolean
          legal_entity_id?: string
          notes?: string | null
          precedence_over_weekday?: boolean
          price?: number
          price_list_id?: string | null
          product_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "special_prices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_prices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_prices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_prices_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_prices_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          legal_entity_id: string
          name: string
          notes: string | null
          org_number: string | null
          tripletex_supplier_id: string | null
          tripletex_supplier_number: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          legal_entity_id: string
          name: string
          notes?: string | null
          org_number?: string | null
          tripletex_supplier_id?: string | null
          tripletex_supplier_number?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          legal_entity_id?: string
          name?: string
          notes?: string | null
          org_number?: string | null
          tripletex_supplier_id?: string | null
          tripletex_supplier_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          ai_summarized_at: string | null
          ai_summary: string | null
          attached_at: string | null
          attached_by: string | null
          attached_to_order_id: string | null
          content_type: string | null
          created_at: string
          file_name: string
          id: string
          is_inline: boolean
          kind: string
          microsoft_attachment_id: string | null
          size_bytes: number | null
          storage_path: string | null
          ticket_id: string
        }
        Insert: {
          ai_summarized_at?: string | null
          ai_summary?: string | null
          attached_at?: string | null
          attached_by?: string | null
          attached_to_order_id?: string | null
          content_type?: string | null
          created_at?: string
          file_name: string
          id?: string
          is_inline?: boolean
          kind?: string
          microsoft_attachment_id?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          ticket_id: string
        }
        Update: {
          ai_summarized_at?: string | null
          ai_summary?: string | null
          attached_at?: string | null
          attached_by?: string | null
          attached_to_order_id?: string | null
          content_type?: string | null
          created_at?: string
          file_name?: string
          id?: string
          is_inline?: boolean
          kind?: string
          microsoft_attachment_id?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_attached_to_order_id_fkey"
            columns: ["attached_to_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          actor_label: string | null
          actor_type: string
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          order_id: string | null
          payload: Json
          summary: string | null
          ticket_id: string | null
        }
        Insert: {
          actor_label?: string | null
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          order_id?: string | null
          payload?: Json
          summary?: string | null
          ticket_id?: string | null
        }
        Update: {
          actor_label?: string | null
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          order_id?: string | null
          payload?: Json
          summary?: string | null
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_internal_comment_reads: {
        Row: {
          comment_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_internal_comment_reads_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "ticket_internal_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_internal_comments: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          created_at: string
          id: string
          mentioned_teams: Database["public"]["Enums"]["ticket_team"][]
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          mentioned_teams?: Database["public"]["Enums"]["ticket_team"][]
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          mentioned_teams?: Database["public"]["Enums"]["ticket_team"][]
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_internal_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_replies: {
        Row: {
          body_rendered: string | null
          body_text: string
          created_at: string
          error_message: string | null
          id: string
          microsoft_conversation_id: string | null
          microsoft_message_id: string | null
          send_status: string
          sent_at: string | null
          sent_by: string
          ticket_id: string
        }
        Insert: {
          body_rendered?: string | null
          body_text: string
          created_at?: string
          error_message?: string | null
          id?: string
          microsoft_conversation_id?: string | null
          microsoft_message_id?: string | null
          send_status?: string
          sent_at?: string | null
          sent_by: string
          ticket_id: string
        }
        Update: {
          body_rendered?: string | null
          body_text?: string
          created_at?: string
          error_message?: string | null
          id?: string
          microsoft_conversation_id?: string | null
          microsoft_message_id?: string | null
          send_status?: string
          sent_at?: string | null
          sent_by?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_replies_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_subscriptions: {
        Row: {
          client_state: string
          created_at: string
          expiration_date_time: string
          id: string
          last_renewed_at: string | null
          microsoft_subscription_id: string
          notification_url: string
          resource: string
        }
        Insert: {
          client_state: string
          created_at?: string
          expiration_date_time: string
          id?: string
          last_renewed_at?: string | null
          microsoft_subscription_id: string
          notification_url: string
          resource: string
        }
        Update: {
          client_state?: string
          created_at?: string
          expiration_date_time?: string
          id?: string
          last_renewed_at?: string | null
          microsoft_subscription_id?: string
          notification_url?: string
          resource?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          ai_analyzed_at: string | null
          ai_confidence_score: number | null
          ai_cost_usd: number | null
          ai_error: string | null
          ai_model: string | null
          ai_provider: string | null
          ai_status: string | null
          ai_suggestion: Json | null
          assigned_team: Database["public"]["Enums"]["ticket_team"] | null
          assigned_to: string | null
          awaiting_internal: boolean
          body_html: string | null
          body_preview: string | null
          body_text: string | null
          cc_recipients: Json
          conversation_id: string | null
          created_at: string
          has_attachments: boolean
          id: string
          importance: string | null
          internal_notes: string | null
          microsoft_internet_message_id: string | null
          microsoft_message_id: string
          priority: string
          received_at: string
          related_order_id: string | null
          sender_email: string
          sender_name: string | null
          source_mailbox: string
          status: string
          subject: string | null
          to_recipients: Json
          updated_at: string
        }
        Insert: {
          ai_analyzed_at?: string | null
          ai_confidence_score?: number | null
          ai_cost_usd?: number | null
          ai_error?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          ai_status?: string | null
          ai_suggestion?: Json | null
          assigned_team?: Database["public"]["Enums"]["ticket_team"] | null
          assigned_to?: string | null
          awaiting_internal?: boolean
          body_html?: string | null
          body_preview?: string | null
          body_text?: string | null
          cc_recipients?: Json
          conversation_id?: string | null
          created_at?: string
          has_attachments?: boolean
          id?: string
          importance?: string | null
          internal_notes?: string | null
          microsoft_internet_message_id?: string | null
          microsoft_message_id: string
          priority?: string
          received_at: string
          related_order_id?: string | null
          sender_email: string
          sender_name?: string | null
          source_mailbox?: string
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
        }
        Update: {
          ai_analyzed_at?: string | null
          ai_confidence_score?: number | null
          ai_cost_usd?: number | null
          ai_error?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          ai_status?: string | null
          ai_suggestion?: Json | null
          assigned_team?: Database["public"]["Enums"]["ticket_team"] | null
          assigned_to?: string | null
          awaiting_internal?: boolean
          body_html?: string | null
          body_preview?: string | null
          body_text?: string | null
          cc_recipients?: Json
          conversation_id?: string | null
          created_at?: string
          has_attachments?: boolean
          id?: string
          importance?: string | null
          internal_notes?: string | null
          microsoft_internet_message_id?: string | null
          microsoft_message_id?: string
          priority?: string
          received_at?: string
          related_order_id?: string | null
          sender_email?: string
          sender_name?: string | null
          source_mailbox?: string
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tripletex_credentials: {
        Row: {
          consumer_token_encrypted: string | null
          created_at: string
          employee_token_encrypted: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          last_synced_voucher_date: string | null
          legal_entity_id: string
          mode: string
          session_expires_at: string | null
          session_token: string | null
          sync_enabled: boolean
          sync_frequency_minutes: number
          updated_at: string
        }
        Insert: {
          consumer_token_encrypted?: string | null
          created_at?: string
          employee_token_encrypted?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          last_synced_voucher_date?: string | null
          legal_entity_id: string
          mode?: string
          session_expires_at?: string | null
          session_token?: string | null
          sync_enabled?: boolean
          sync_frequency_minutes?: number
          updated_at?: string
        }
        Update: {
          consumer_token_encrypted?: string | null
          created_at?: string
          employee_token_encrypted?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          last_synced_voucher_date?: string | null
          legal_entity_id?: string
          mode?: string
          session_expires_at?: string | null
          session_token?: string | null
          sync_enabled?: boolean
          sync_frequency_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tripletex_credentials_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: true
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      tripletex_sync_log: {
        Row: {
          completed_at: string | null
          details: Json | null
          error_message: string | null
          id: string
          legal_entity_id: string
          started_at: string
          status: string
          vouchers_failed: number
          vouchers_fetched: number
          vouchers_imported: number
          vouchers_skipped: number
        }
        Insert: {
          completed_at?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          legal_entity_id: string
          started_at?: string
          status?: string
          vouchers_failed?: number
          vouchers_fetched?: number
          vouchers_imported?: number
          vouchers_skipped?: number
        }
        Update: {
          completed_at?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          legal_entity_id?: string
          started_at?: string
          status?: string
          vouchers_failed?: number
          vouchers_fetched?: number
          vouchers_imported?: number
          vouchers_skipped?: number
        }
        Relationships: [
          {
            foreignKeyName: "tripletex_sync_log_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_invitations: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          user_id?: string
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
      user_team_memberships: {
        Row: {
          created_at: string
          id: string
          team: Database["public"]["Enums"]["ticket_team"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team: Database["public"]["Enums"]["ticket_team"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team?: Database["public"]["Enums"]["ticket_team"]
          user_id?: string
        }
        Relationships: []
      }
      user_ui_preferences: {
        Row: {
          created_at: string
          scope: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          created_at?: string
          scope: string
          updated_at?: string
          user_id: string
          value?: Json
        }
        Update: {
          created_at?: string
          scope?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: []
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
      product_nutrition_calculated: {
        Row: {
          carbs_g_per_100g: number | null
          energy_kcal_per_100g: number | null
          energy_kj_per_100g: number | null
          fat_g_per_100g: number | null
          fiber_g_per_100g: number | null
          final_weight_grams: number | null
          ingredient_count: number | null
          ingredients_with_nutrition: number | null
          product_id: string | null
          product_recipe_link_id: string | null
          protein_g_per_100g: number | null
          salt_g_per_100g: number | null
          saturated_fat_g_per_100g: number | null
          sugars_g_per_100g: number | null
          total_input_grams: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_recipe_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_monthly_purchases: {
        Row: {
          avg_price_per_base_unit: number | null
          invoice_count: number | null
          legal_entity_id: string | null
          month_start: string | null
          raw_material_id: string | null
          supplier_id: string | null
          total_cost: number | null
          total_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_purchase_stats: {
        Row: {
          avg_monthly_volume: number | null
          avg_price_per_base_unit_12m: number | null
          cost_12m: number | null
          cost_24m: number | null
          cost_30d: number | null
          cost_90d: number | null
          has_package_size_warning: boolean | null
          invoice_count_12m: number | null
          invoice_count_30d: number | null
          invoice_count_90d: number | null
          last_invoice_date: string | null
          legal_entity_id: string | null
          quantity_12m: number | null
          quantity_24m: number | null
          quantity_30d: number | null
          quantity_90d: number | null
          raw_material_id: string | null
          supplier_count_12m: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_supplier_purchase_stats: {
        Row: {
          cost_12m: number | null
          cost_24m: number | null
          invoice_count_12m: number | null
          last_invoice_date: string | null
          legal_entity_id: string | null
          quantity_12m: number | null
          quantity_24m: number | null
          raw_material_id: string | null
          supplier_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_nutrition_calculated: {
        Row: {
          carbs_g_per_100g: number | null
          energy_kcal_per_100g: number | null
          energy_kj_per_100g: number | null
          fat_g_per_100g: number | null
          fiber_g_per_100g: number | null
          final_weight_grams: number | null
          ingredient_count: number | null
          ingredients_with_nutrition: number | null
          protein_g_per_100g: number | null
          recipe_id: string | null
          salt_g_per_100g: number | null
          saturated_fat_g_per_100g: number | null
          sugars_g_per_100g: number | null
          total_input_grams: number | null
        }
        Relationships: []
      }
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
      _import_upsert_price: {
        Args: { p_price: number; p_price_list_id: string; p_product_id: string }
        Returns: number
      }
      _pos_period_aggregate: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_terminal_id: string
        }
        Returns: Json
      }
      _validate_and_resolve_cake_line: {
        Args: { p_legal_entity_id: string; p_merknad: Json }
        Returns: {
          category_id: string
          category_name: string
          is_cake: boolean
          resolved_product_id: string
          resolved_unit_price: number
        }[]
      }
      app_access_level: {
        Args: { p_app_code: string }
        Returns: Database["public"]["Enums"]["access_level"]
      }
      assign_label_number: {
        Args: {
          p_dept_id: string
          p_order_line_id: string
          p_product_id: string
          p_seq_date?: string
        }
        Returns: string
      }
      build_cake_order_line: {
        Args: {
          p_category_id: string
          p_price_list_id: string
          p_selections: Json
        }
        Returns: Json
      }
      calculate_cake_price: {
        Args: {
          p_category_id: string
          p_price_list_id: string
          p_selected_option_ids: string[]
        }
        Returns: Json
      }
      change_order_tour: {
        Args: { p_new_tour_id: string; p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      check_order_deadline_violations: {
        Args: {
          p_customer_id: string
          p_delivery_date: string
          p_delivery_tour_id?: string
          p_legal_entity_id: string
          p_product_group_ids?: string[]
          p_product_ids?: string[]
        }
        Returns: {
          deadline_timestamp: string
          is_passed: boolean
          minutes_over: number
          rule_id: string
          rule_name: string
        }[]
      }
      current_portal_customer_id: { Args: never; Returns: string }
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
      customer_effective_price_list: {
        Args: { _customer_id: string }
        Returns: string
      }
      delete_demo_data: {
        Args: never
        Returns: {
          deleted_count: number
          entity: string
        }[]
      }
      delete_matrix_column: {
        Args: { p_customer_id: string; p_date: string; p_tour_id: string }
        Returns: {
          lines_deleted: number
          order_deleted: boolean
        }[]
      }
      extract_legal_entity_id_from_path: {
        Args: { path: string }
        Returns: string
      }
      gen_rfq_password: { Args: never; Returns: string }
      gen_rfq_token: { Args: never; Returns: string }
      generate_delivery_notes: {
        Args: {
          p_delivery_date: string
          p_legal_entity_id: string
          p_run_type?: string
          p_tour_filter?: string[]
        }
        Returns: Json
      }
      generate_next_gtin: {
        Args: { p_legal_entity_id: string }
        Returns: string
      }
      get_addable_products: {
        Args: { p_customer_id: string }
        Returns: {
          display_name: string
          display_number: number
          id: string
          sales_unit: string
          unit_price: number
        }[]
      }
      get_apps_for_entity: {
        Args: { entity_id: string }
        Returns: {
          access_level: Database["public"]["Enums"]["access_level"]
          category: string
          color_hex: string
          deploy_url: string
          display_name: string
          icon_name: string
          id: string
          slug: string
          sort_order: number
          start_path: string
          status: string
        }[]
      }
      get_cake_categories_with_counts: {
        Args: { p_legal_entity_id: string }
        Returns: {
          description: string
          id: string
          image_url: string
          name: string
          product_count: number
          sort_order: number
          status: string
          step_count: number
        }[]
      }
      get_cake_category_wizard: {
        Args: { p_category_id: string; p_price_list_id: string }
        Returns: Json
      }
      get_customer_effective_settings: {
        Args: { p_customer_id: string }
        Returns: Json
      }
      get_customer_matrix_data: {
        Args: { p_customer_id: string; p_date_from: string; p_date_to: string }
        Returns: {
          payload: Json
          section: string
        }[]
      }
      get_customer_unit_price: {
        Args: {
          p_caller?: string
          p_customer_id: string
          p_date?: string
          p_product_id: string
        }
        Returns: {
          is_fallback: boolean
          price_list_id: string
          source: string
          special_price_id: string
          unit_price_excl_mva: number
          vat_rate: number
        }[]
      }
      get_customer_unit_prices_batch: {
        Args: {
          p_caller?: string
          p_customer_id: string
          p_date?: string
          p_product_ids: string[]
        }
        Returns: {
          is_fallback: boolean
          price_list_id: string
          product_id: string
          source: string
          special_price_id: string
          unit_price_excl_mva: number
          vat_rate: number
        }[]
      }
      get_effective_price: {
        Args: {
          p_customer_id?: string
          p_date?: string
          p_price_list_id?: string
          p_product_id: string
        }
        Returns: {
          is_net: boolean
          price: number
          price_list_id: string
          source: string
          special_price_id: string
        }[]
      }
      get_email_m365_status: {
        Args: never
        Returns: {
          account_email: string
          connected: boolean
          connected_at: string
          expires_at: string
          last_refresh_at: string
          scope: string
          tenant_id: string
        }[]
      }
      get_label_products_for_date: {
        Args: {
          p_date: string
          p_legal_entity_id: string
          p_tour_ids?: string[]
        }
        Returns: {
          department_ids: string[]
          display_name: string
          display_number: number
          label_mode: string
          label_print_model: string
          order_line_ids: string[]
          product_id: string
          total_labels: number
          unique_notes: string[]
        }[]
      }
      get_my_accessible_apps: {
        Args: never
        Returns: {
          access_level: Database["public"]["Enums"]["access_level"]
          category: string
          color_hex: string
          deploy_url: string
          display_name: string
          icon_name: string
          id: string
          slug: string
          sort_order: number
          start_path: string
          status: string
        }[]
      }
      get_ordrekontor_assignees: {
        Args: never
        Returns: {
          display_name: string
          id: string
        }[]
      }
      get_raw_material_purchase_stats: {
        Args: { p_raw_material_id: string }
        Returns: {
          avg_monthly_volume: number | null
          avg_price_per_base_unit_12m: number | null
          cost_12m: number | null
          cost_24m: number | null
          cost_30d: number | null
          cost_90d: number | null
          has_package_size_warning: boolean | null
          invoice_count_12m: number | null
          invoice_count_30d: number | null
          invoice_count_90d: number | null
          last_invoice_date: string | null
          legal_entity_id: string | null
          quantity_12m: number | null
          quantity_24m: number | null
          quantity_30d: number | null
          quantity_90d: number | null
          raw_material_id: string | null
          supplier_count_12m: number | null
        }
        SetofOptions: {
          from: "*"
          to: "raw_material_purchase_stats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_recurring_items_for_delivery: {
        Args: { _delivery_date: string; _legal_entity_id: string }
        Returns: {
          customer_id: string
          customer_name: string
          notes: string
          product_id: string
          product_name: string
          quantity: number
          schedule_id: string
          tour_id: string
        }[]
      }
      gtin_check_digit: { Args: { p_base12: string }; Returns: number }
      has_access_to_outlet: { Args: { p_outlet_id: string }; Returns: boolean }
      has_active_position: {
        Args: { p_position_code: string }
        Returns: boolean
      }
      has_app_admin_access: { Args: { p_app_code: string }; Returns: boolean }
      has_app_write_access: { Args: { p_app_code: string }; Returns: boolean }
      has_fakturaer_access: {
        Args: { _legal_entity_id: string; _required_level?: string }
        Returns: boolean
      }
      has_fakturaer_read_or_owner: {
        Args: { _legal_entity_id: string }
        Returns: boolean
      }
      has_negotiation_read: {
        Args: { _legal_entity_id: string }
        Returns: boolean
      }
      has_negotiation_write: {
        Args: { _legal_entity_id: string }
        Returns: boolean
      }
      has_ordre_settings_access: { Args: never; Returns: boolean }
      has_position_in_entity: {
        Args: { p_legal_entity_id: string }
        Returns: boolean
      }
      has_ravarer_access: {
        Args: {
          _legal_entity_id: string
          _min_level: Database["public"]["Enums"]["access_level"]
          _user_id: string
        }
        Returns: boolean
      }
      has_ravarer_invoice_access: {
        Args: { _legal_entity_id: string; _required_level?: string }
        Returns: boolean
      }
      has_ravarer_invoice_read_or_owner: {
        Args: { _legal_entity_id: string }
        Returns: boolean
      }
      has_specific_position_in_entity: {
        Args: { p_legal_entity_id: string; p_position_code: string }
        Returns: boolean
      }
      import_tedebe_products_prices: {
        Args: {
          p_legal_entity_id: string
          p_options: Json
          p_rows: Json
          p_source_filename: string
          p_user_id: string
        }
        Returns: Json
      }
      is_kiosk_user: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_platform_owner: { Args: { _user_id: string }; Returns: boolean }
      is_ravarer_owner: { Args: { _user_id: string }; Returns: boolean }
      list_active_cake_categories: {
        Args: { p_legal_entity_id: string }
        Returns: {
          base_price: number
          description: string
          id: string
          image_url: string
          name: string
          sort_order: number
        }[]
      }
      list_monthly_purchases: {
        Args: {
          p_legal_entity_id: string
          p_month_from?: string
          p_month_to?: string
          p_raw_material_id?: string
          p_supplier_id?: string
        }
        Returns: {
          avg_price_per_base_unit: number
          invoice_count: number
          month_start: string
          raw_material_id: string
          supplier_id: string
          total_cost: number
          total_quantity: number
        }[]
      }
      list_raw_material_purchase_stats: {
        Args: { p_legal_entity_id: string }
        Returns: {
          avg_monthly_volume: number | null
          avg_price_per_base_unit_12m: number | null
          cost_12m: number | null
          cost_24m: number | null
          cost_30d: number | null
          cost_90d: number | null
          has_package_size_warning: boolean | null
          invoice_count_12m: number | null
          invoice_count_30d: number | null
          invoice_count_90d: number | null
          last_invoice_date: string | null
          legal_entity_id: string | null
          quantity_12m: number | null
          quantity_24m: number | null
          quantity_30d: number | null
          quantity_90d: number | null
          raw_material_id: string | null
          supplier_count_12m: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "raw_material_purchase_stats"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_supplier_purchase_stats: {
        Args: { p_supplier_id: string }
        Returns: {
          cost_12m: number | null
          cost_24m: number | null
          invoice_count_12m: number | null
          last_invoice_date: string | null
          legal_entity_id: string | null
          quantity_12m: number | null
          quantity_24m: number | null
          raw_material_id: string | null
          supplier_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "raw_material_supplier_purchase_stats"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      materialize_recurring_orders: {
        Args: {
          p_created_by?: string
          p_delivery_date: string
          p_legal_entity_id: string
          p_tour_filter?: string[]
        }
        Returns: number
      }
      negotiation_recipient_by_token: {
        Args: { p_password: string; p_token: string }
        Returns: {
          expires_at: string
          negotiation_id: string
          negotiation_title: string
          recipient_id: string
          response_deadline: string
          result: string
          status: string
          supplier_id: string
        }[]
      }
      next_customer_number: {
        Args: { p_legal_entity_id: string; p_profile_id: string }
        Returns: number
      }
      next_display_number: {
        Args: { p_domain: string; p_legal_entity_id: string }
        Returns: number
      }
      next_label_number: {
        Args: { p_dept_id: string; p_seq_date?: string }
        Returns: string
      }
      next_order_number: {
        Args: { p_legal_entity_id: string }
        Returns: {
          order_number: string
          order_sequence: number
          order_year: number
        }[]
      }
      portal_create_customer_order: { Args: { p_payload: Json }; Returns: Json }
      portal_create_order: { Args: { p_payload: Json }; Returns: Json }
      portal_create_return_order: { Args: { p_payload: Json }; Returns: Json }
      portal_get_matrix: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      portal_get_order: { Args: { p_order_id: string }; Returns: Json }
      portal_get_returnable_lines: {
        Args: { p_delivery_note_id: string }
        Returns: {
          already_returned_quantity: number
          delivered_quantity: number
          delivery_note_line_id: string
          display_name: string
          display_number: number
          max_returnable_quantity: number
          original_unit_price: number
          product_id: string
          return_price_type: string
          return_unit_price: number
          return_value: number
          sales_unit: string
          vat_rate: number
        }[]
      }
      portal_list_products: {
        Args: never
        Returns: {
          description: string
          display_name: string
          display_number: number
          image_url: string
          is_divisible: boolean
          lead_time_days: number
          min_quantity: number
          mva_rate: number
          pause_delivery_from: string
          pause_delivery_to: string
          pieces_per_unit: number
          price: number
          prices_include_mva: boolean
          product_category: string
          product_id: string
          unit_of_sale: string
        }[]
      }
      portal_list_returnable_deliveries: {
        Args: never
        Returns: {
          delivery_date: string
          delivery_note_id: string
          delivery_tour_id: string
          display_number: string
          has_existing_return: boolean
          returnable_lines: number
          total_lines: number
          tour_number: number
        }[]
      }
      portal_mark_picked_up: {
        Args: { p_order_id: string; p_picked_up?: boolean }
        Returns: Json
      }
      portal_save_matrix: {
        Args: { p_changes: Json }
        Returns: {
          lines_created: number
          lines_deleted: number
          lines_updated: number
          orders_created: number
          orders_deleted: number
        }[]
      }
      portal_search_my_orders: {
        Args: {
          p_from_date?: string
          p_limit?: number
          p_offset?: number
          p_picked_up_filter?: string
          p_search?: string
          p_status_filter?: string[]
          p_to_date?: string
          p_type_filter?: string
        }
        Returns: {
          customer_notes_preview: string
          delivery_date: string
          delivery_time: string
          delivery_tour_id: string
          distribution: string
          final_customer_name: string
          has_picked_up: boolean
          is_customer_order: boolean
          is_return: boolean
          line_count: number
          order_id: string
          order_number: string
          ordered_at: string
          picked_up_at: string
          source: string
          status: string
          total_count: number
          total_incl_vat: number
          tour_number: number
        }[]
      }
      portal_set_own_geocode: {
        Args: { p_latitude: number; p_longitude: number; p_source: string }
        Returns: undefined
      }
      portal_update_recurring_item: {
        Args: {
          p_product_id: string
          p_quantity: number
          p_tour_id: string
          p_weekday: number
        }
        Returns: Json
      }
      pos_close_session: {
        Args: {
          p_closing_float: number
          p_counted_cash: number
          p_session_id: string
        }
        Returns: undefined
      }
      pos_complete_pickup_order: {
        Args: { p_order_id: string; p_pos_transaction_id?: string }
        Returns: undefined
      }
      pos_create_cake_order: { Args: { p_payload: Json }; Returns: Json }
      pos_create_operator: {
        Args: {
          p_display_name: string
          p_legal_entity_id: string
          p_operator_code: string
          p_pin: string
          p_user_id?: string
        }
        Returns: string
      }
      pos_generate_x_report: { Args: { p_session_id: string }; Returns: Json }
      pos_generate_z_report: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_terminal_id: string
        }
        Returns: string
      }
      pos_list_pickup_orders: {
        Args: {
          p_date: string
          p_legal_entity_id: string
          p_pickup_location_id: string
        }
        Returns: {
          delivery_date: string
          final_customer_name: string
          final_customer_phone: string
          id: string
          is_paid: boolean
          order_number: string
          payment_mode: string
          picked_up_at: string
          status: string
          total_incl_vat: number
        }[]
      }
      pos_load_pickup_order: { Args: { p_order_id: string }; Returns: Json }
      pos_next_receipt_number: {
        Args: { p_terminal_id: string }
        Returns: {
          receipt_number: string
          receipt_sequence: number
        }[]
      }
      pos_open_session: {
        Args: {
          p_opening_float: number
          p_operator_id: string
          p_terminal_id: string
        }
        Returns: string
      }
      pos_operator_authenticate: {
        Args: { p_operator_code: string; p_pin: string; p_terminal_id: string }
        Returns: {
          can_use_terminal: boolean
          display_name: string
          legal_entity_id: string
          operator_id: string
        }[]
      }
      pos_record_sale: {
        Args: {
          p_customer_id?: string
          p_dining_mode?: string
          p_is_training?: boolean
          p_lines: Json
          p_payment_summary: Json
          p_reference_transaction_id?: string
          p_session_id: string
          p_transaction_type?: string
        }
        Returns: string
      }
      pos_set_operator_pin: {
        Args: { p_new_pin: string; p_operator_id: string }
        Returns: undefined
      }
      pos_set_product_name: {
        Args: { p_pos_name: string; p_product_id: string }
        Returns: undefined
      }
      pos_set_product_station: {
        Args: { p_product_id: string; p_station_id: string }
        Returns: undefined
      }
      pos_sync_customer: {
        Args: { p_customer_id: string; p_enabled: boolean }
        Returns: {
          created_at: string
          credit_limit: number | null
          default_invoice_method: string | null
          display_name: string
          email: string | null
          id: string
          invoice_address: Json | null
          last_synced_at: string | null
          legal_entity_id: string
          notes: string | null
          org_number: string | null
          phone: string | null
          source_customer_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pos_customers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pos_verify_journal_chain: {
        Args: { p_terminal_id: string }
        Returns: {
          broken_at_id: number
          is_valid: boolean
          total_events: number
        }[]
      }
      refresh_purchase_stats: { Args: never; Returns: undefined }
      rename_raw_material: {
        Args: { p_id: string; p_name: string }
        Returns: {
          agreed_price: number | null
          base_unit: string
          categories: string[]
          category: string | null
          components_reviewed_at: string | null
          created_at: string
          created_by: string | null
          current_cost_price: number | null
          current_stock: number
          description: string | null
          grain_classification: string | null
          id: string
          is_active: boolean
          is_composite: boolean
          is_packaging: boolean
          legal_entity_id: string
          min_stock: number | null
          name: string
          package_size: number | null
          package_unit: string | null
          price_source: string | null
          price_updated_at: string | null
          primary_supplier_id: string | null
          sku: string
          unit_weight_grams: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "raw_materials"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rm_can_read: { Args: { _rm_id: string }; Returns: boolean }
      rm_can_write: { Args: { _rm_id: string }; Returns: boolean }
      save_matrix_changes: {
        Args: { p_changes: Json; p_customer_id: string }
        Returns: {
          has_zero_fallback_lines: string[]
          lines_created: number
          lines_deleted: number
          lines_updated: number
          orders_created: number
          orders_deleted: number
        }[]
      }
      set_rfq_password: { Args: { p_recipient_id: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      tripletex_token_status: {
        Args: { _legal_entity_id: string }
        Returns: {
          has_consumer_token: boolean
          has_employee_token: boolean
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      undo_delivery_runs: {
        Args: {
          p_delivery_date: string
          p_legal_entity_id: string
          p_tour_filter?: string[]
        }
        Returns: Json
      }
      upsert_matrix_column_comment: {
        Args: {
          p_comment: string
          p_customer_id: string
          p_date: string
          p_tour_id: string
        }
        Returns: string
      }
      user_has_invoice_access: { Args: never; Returns: boolean }
      user_has_legal_entity_access: { Args: { _le: string }; Returns: boolean }
      validate_order_delivery_rules: {
        Args: {
          p_customer_id: string
          p_delivery_date: string
          p_delivery_tour_id?: string
          p_legal_entity_id: string
          p_ordered_at?: string
          p_product_ids?: string[]
        }
        Returns: Json
      }
      verify_gtin: { Args: { p_gtin: string }; Returns: boolean }
    }
    Enums: {
      access_level: "none" | "read" | "write" | "approve" | "admin"
      alias_status: "confirmed" | "pending" | "rejected" | "superseded"
      alias_type: "supplier_sku" | "product_name" | "ean" | "gtin"
      allergen_presence: "contains" | "may_contain" | "free_from"
      allergen_type:
        | "gluten_wheat"
        | "gluten_rye"
        | "gluten_barley"
        | "gluten_oats"
        | "gluten_spelt"
        | "crustaceans"
        | "eggs"
        | "fish"
        | "peanuts"
        | "soybeans"
        | "milk"
        | "nuts_almond"
        | "nuts_hazelnut"
        | "nuts_walnut"
        | "nuts_cashew"
        | "nuts_pecan"
        | "nuts_brazil"
        | "nuts_pistachio"
        | "nuts_macadamia"
        | "celery"
        | "mustard"
        | "sesame"
        | "sulphites"
        | "lupin"
        | "molluscs"
      declaration_mode: "auto" | "manual" | "auto_with_overrides"
      negotiation_recipient_status:
        | "invited"
        | "viewed"
        | "responded"
        | "declined"
        | "expired"
        | "locked"
      negotiation_response_status: "draft" | "submitted" | "withdrawn"
      negotiation_status:
        | "draft"
        | "invited"
        | "in_progress"
        | "concluded"
        | "cancelled"
        | "awaiting_confirmation"
      ticket_team:
        | "kundeservice"
        | "produksjon"
        | "butikk"
        | "konditor"
        | "admin"
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
      alias_status: ["confirmed", "pending", "rejected", "superseded"],
      alias_type: ["supplier_sku", "product_name", "ean", "gtin"],
      allergen_presence: ["contains", "may_contain", "free_from"],
      allergen_type: [
        "gluten_wheat",
        "gluten_rye",
        "gluten_barley",
        "gluten_oats",
        "gluten_spelt",
        "crustaceans",
        "eggs",
        "fish",
        "peanuts",
        "soybeans",
        "milk",
        "nuts_almond",
        "nuts_hazelnut",
        "nuts_walnut",
        "nuts_cashew",
        "nuts_pecan",
        "nuts_brazil",
        "nuts_pistachio",
        "nuts_macadamia",
        "celery",
        "mustard",
        "sesame",
        "sulphites",
        "lupin",
        "molluscs",
      ],
      declaration_mode: ["auto", "manual", "auto_with_overrides"],
      negotiation_recipient_status: [
        "invited",
        "viewed",
        "responded",
        "declined",
        "expired",
        "locked",
      ],
      negotiation_response_status: ["draft", "submitted", "withdrawn"],
      negotiation_status: [
        "draft",
        "invited",
        "in_progress",
        "concluded",
        "cancelled",
        "awaiting_confirmation",
      ],
      ticket_team: [
        "kundeservice",
        "produksjon",
        "butikk",
        "konditor",
        "admin",
      ],
    },
  },
} as const

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
          payment_terms_days: number | null
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
          payment_terms_days?: number | null
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
          payment_terms_days?: number | null
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
        ]
      }
      customers: {
        Row: {
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_city: string | null
          billing_country: string | null
          billing_postal_code: string | null
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
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
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
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
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
      order_lines: {
        Row: {
          created_at: string
          discount_percent: number
          id: string
          line_number: number
          line_subtotal_excl_vat: number
          line_total_incl_vat: number
          line_vat: number
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
          created_at?: string
          discount_percent?: number
          id?: string
          line_number: number
          line_subtotal_excl_vat: number
          line_total_incl_vat: number
          line_vat: number
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
          created_at?: string
          discount_percent?: number
          id?: string
          line_number?: number
          line_subtotal_excl_vat?: number
          line_total_incl_vat?: number
          line_vat?: number
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
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          customer_notes: string | null
          customer_snapshot: Json
          delivery_address_line1: string | null
          delivery_address_line2: string | null
          delivery_city: string | null
          delivery_country: string | null
          delivery_date: string
          delivery_instructions: string | null
          delivery_postal_code: string | null
          delivery_time: string | null
          id: string
          internal_notes: string | null
          invoice_recipient_customer_id: string | null
          invoice_recipient_snapshot: Json | null
          legal_entity_id: string
          order_number: string
          order_sequence: number
          order_year: number
          ordered_at: string
          previous_status_before_hold: string | null
          source: string
          source_reference: string | null
          status: string
          status_changed_at: string
          status_changed_by: string | null
          subtotal_excl_vat: number
          total_discount: number
          total_incl_vat: number
          total_vat: number
          updated_at: string
          use_customer_default_address: boolean
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          customer_notes?: string | null
          customer_snapshot?: Json
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_date: string
          delivery_instructions?: string | null
          delivery_postal_code?: string | null
          delivery_time?: string | null
          id?: string
          internal_notes?: string | null
          invoice_recipient_customer_id?: string | null
          invoice_recipient_snapshot?: Json | null
          legal_entity_id: string
          order_number: string
          order_sequence: number
          order_year: number
          ordered_at?: string
          previous_status_before_hold?: string | null
          source: string
          source_reference?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          subtotal_excl_vat?: number
          total_discount?: number
          total_incl_vat?: number
          total_vat?: number
          updated_at?: string
          use_customer_default_address?: boolean
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          customer_notes?: string | null
          customer_snapshot?: Json
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_date?: string
          delivery_instructions?: string | null
          delivery_postal_code?: string | null
          delivery_time?: string | null
          id?: string
          internal_notes?: string | null
          invoice_recipient_customer_id?: string | null
          invoice_recipient_snapshot?: Json | null
          legal_entity_id?: string
          order_number?: string
          order_sequence?: number
          order_year?: number
          ordered_at?: string
          previous_status_before_hold?: string | null
          source?: string
          source_reference?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
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
          mva_rate: number
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
          mva_rate?: number
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
          mva_rate?: number
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
      production_groups: {
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
            foreignKeyName: "production_groups_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          account_reference: string | null
          code: string
          created_at: string
          created_by: string | null
          datasheet_url: string | null
          description: string | null
          description_rich: Json | null
          display_name: string
          display_number: number
          dough_type: string | null
          ean_code: string | null
          epd_number: string | null
          gtin: string | null
          id: string
          image_url: string | null
          in_web_shop: boolean
          include_in_price_lists: boolean
          internal_sku: string | null
          is_divisible: boolean
          is_for_sale: boolean
          is_package: boolean
          is_production_group_main: boolean
          is_warehouse_item: boolean
          keywords: string[] | null
          lead_time_days: number | null
          legal_entity_id: string
          main_category_id: string | null
          mva_always_included: boolean
          mva_rate: number
          pause_delivery_from: string | null
          pause_delivery_to: string | null
          pause_reason: string | null
          pause_reason_customer: string | null
          pieces_per_liter: number | null
          pieces_per_tray: number | null
          pieces_per_unit: number | null
          print_declaration_labels: boolean
          product_category: string
          product_page_id: string | null
          product_subcategory: string | null
          production_buffer: number | null
          production_group_id: string | null
          shelf_life_chilled_days: number | null
          shelf_life_frozen_days: number | null
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
          code: string
          created_at?: string
          created_by?: string | null
          datasheet_url?: string | null
          description?: string | null
          description_rich?: Json | null
          display_name: string
          display_number: number
          dough_type?: string | null
          ean_code?: string | null
          epd_number?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          in_web_shop?: boolean
          include_in_price_lists?: boolean
          internal_sku?: string | null
          is_divisible?: boolean
          is_for_sale?: boolean
          is_package?: boolean
          is_production_group_main?: boolean
          is_warehouse_item?: boolean
          keywords?: string[] | null
          lead_time_days?: number | null
          legal_entity_id: string
          main_category_id?: string | null
          mva_always_included?: boolean
          mva_rate?: number
          pause_delivery_from?: string | null
          pause_delivery_to?: string | null
          pause_reason?: string | null
          pause_reason_customer?: string | null
          pieces_per_liter?: number | null
          pieces_per_tray?: number | null
          pieces_per_unit?: number | null
          print_declaration_labels?: boolean
          product_category: string
          product_page_id?: string | null
          product_subcategory?: string | null
          production_buffer?: number | null
          production_group_id?: string | null
          shelf_life_chilled_days?: number | null
          shelf_life_frozen_days?: number | null
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
          code?: string
          created_at?: string
          created_by?: string | null
          datasheet_url?: string | null
          description?: string | null
          description_rich?: Json | null
          display_name?: string
          display_number?: number
          dough_type?: string | null
          ean_code?: string | null
          epd_number?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          in_web_shop?: boolean
          include_in_price_lists?: boolean
          internal_sku?: string | null
          is_divisible?: boolean
          is_for_sale?: boolean
          is_package?: boolean
          is_production_group_main?: boolean
          is_warehouse_item?: boolean
          keywords?: string[] | null
          lead_time_days?: number | null
          legal_entity_id?: string
          main_category_id?: string | null
          mva_always_included?: boolean
          mva_rate?: number
          pause_delivery_from?: string | null
          pause_delivery_to?: string | null
          pause_reason?: string | null
          pause_reason_customer?: string | null
          pieces_per_liter?: number | null
          pieces_per_tray?: number | null
          pieces_per_unit?: number | null
          print_declaration_labels?: boolean
          product_category?: string
          product_page_id?: string | null
          product_subcategory?: string | null
          production_buffer?: number | null
          production_group_id?: string | null
          shelf_life_chilled_days?: number | null
          shelf_life_frozen_days?: number | null
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
      recipe_lines: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string | null
          ingredient_name: string
          notes: string | null
          quantity: number
          recipe_id: string
          sort_order: number
          unit: string
          updated_at: string
          waste_percent: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id?: string | null
          ingredient_name: string
          notes?: string | null
          quantity: number
          recipe_id: string
          sort_order?: number
          unit: string
          updated_at?: string
          waste_percent?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string | null
          ingredient_name?: string
          notes?: string | null
          quantity?: number
          recipe_id?: string
          sort_order?: number
          unit?: string
          updated_at?: string
          waste_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          product_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
          version: number
          yield_quantity: number
          yield_unit: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          version?: number
          yield_quantity?: number
          yield_unit?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          version?: number
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
      generate_next_gtin: {
        Args: { p_legal_entity_id: string }
        Returns: string
      }
      get_customer_effective_settings: {
        Args: { p_customer_id: string }
        Returns: Json
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
      gtin_check_digit: { Args: { p_base12: string }; Returns: number }
      has_access_to_outlet: { Args: { p_outlet_id: string }; Returns: boolean }
      has_active_position: {
        Args: { p_position_code: string }
        Returns: boolean
      }
      has_app_admin_access: { Args: { p_app_code: string }; Returns: boolean }
      has_app_write_access: { Args: { p_app_code: string }; Returns: boolean }
      has_position_in_entity: {
        Args: { p_legal_entity_id: string }
        Returns: boolean
      }
      has_specific_position_in_entity: {
        Args: { p_legal_entity_id: string; p_position_code: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      next_customer_number: {
        Args: { p_legal_entity_id: string; p_profile_id: string }
        Returns: number
      }
      next_display_number: {
        Args: { p_domain: string; p_legal_entity_id: string }
        Returns: number
      }
      next_order_number: {
        Args: { p_legal_entity_id: string }
        Returns: {
          order_number: string
          order_sequence: number
          order_year: number
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      verify_gtin: { Args: { p_gtin: string }; Returns: boolean }
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

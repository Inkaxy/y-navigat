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
          created_at: string
          created_by: string | null
          customer_ids: string[] | null
          deadline_days_before: number
          deadline_time: string
          description: string | null
          id: string
          is_active: boolean
          legal_entity_id: string
          name: string
          product_group_ids: string[] | null
          product_ids: string[] | null
          rule_type: string
          tour_filter: string[] | null
          updated_at: string
          valid_from: string
          valid_until: string | null
          weekdays: number[] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_ids?: string[] | null
          deadline_days_before: number
          deadline_time: string
          description?: string | null
          id?: string
          is_active?: boolean
          legal_entity_id: string
          name: string
          product_group_ids?: string[] | null
          product_ids?: string[] | null
          rule_type: string
          tour_filter?: string[] | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
          weekdays?: number[] | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_ids?: string[] | null
          deadline_days_before?: number
          deadline_time?: string
          description?: string | null
          id?: string
          is_active?: boolean
          legal_entity_id?: string
          name?: string
          product_group_ids?: string[] | null
          product_ids?: string[] | null
          rule_type?: string
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
          created_at: string
          founded_year: number | null
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
          swift: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          bank_account?: string | null
          created_at?: string
          founded_year?: number | null
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
          swift?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          bank_account?: string | null
          created_at?: string
          founded_year?: number | null
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
          is_return: boolean
          legal_entity_id: string
          order_number: string
          order_sequence: number
          order_year: number
          ordered_at: string
          picked_up_at: string | null
          picked_up_by: string | null
          previous_status_before_hold: string | null
          send_email_confirm: boolean
          send_sms_confirm: boolean
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
          is_return?: boolean
          legal_entity_id: string
          order_number: string
          order_sequence: number
          order_year: number
          ordered_at?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          previous_status_before_hold?: string | null
          send_email_confirm?: boolean
          send_sms_confirm?: boolean
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
          is_return?: boolean
          legal_entity_id?: string
          order_number?: string
          order_sequence?: number
          order_year?: number
          ordered_at?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          previous_status_before_hold?: string | null
          send_email_confirm?: boolean
          send_sms_confirm?: boolean
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
          id: string
          image_url: string | null
          page_id: string
          product_id: string | null
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
          id?: string
          image_url?: string | null
          page_id: string
          product_id?: string | null
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
          id?: string
          image_url?: string | null
          page_id?: string
          product_id?: string | null
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
        ]
      }
      pos_keypad_layouts: {
        Row: {
          created_at: string
          display_name: string
          grid_cols: number
          grid_rows: number
          id: string
          is_default: boolean
          legal_entity_id: string
          terminal_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          grid_cols?: number
          grid_rows?: number
          id?: string
          is_default?: boolean
          legal_entity_id: string
          terminal_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          grid_cols?: number
          grid_rows?: number
          id?: string
          is_default?: boolean
          legal_entity_id?: string
          terminal_id?: string | null
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
          id: string
          layout_id: string
          page_name: string
          sort_order: number
        }
        Insert: {
          background_color?: string | null
          id?: string
          layout_id: string
          page_name: string
          sort_order?: number
        }
        Update: {
          background_color?: string | null
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
      pos_terminals: {
        Row: {
          created_at: string
          default_price_list_id: string | null
          display_name: string
          id: string
          legal_entity_id: string
          next_receipt_number: number
          next_session_number: number
          next_z_number: number
          outlet_id: string
          printer_config: Json
          receipt_prefix: string
          status: string
          terminal_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_price_list_id?: string | null
          display_name: string
          id?: string
          legal_entity_id: string
          next_receipt_number?: number
          next_session_number?: number
          next_z_number?: number
          outlet_id: string
          printer_config?: Json
          receipt_prefix: string
          status?: string
          terminal_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_price_list_id?: string | null
          display_name?: string
          id?: string
          legal_entity_id?: string
          next_receipt_number?: number
          next_session_number?: number
          next_z_number?: number
          outlet_id?: string
          printer_config?: Json
          receipt_prefix?: string
          status?: string
          terminal_code?: string
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
          allows_return: boolean
          cake_role: string | null
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
          return_price_type: string | null
          return_value: number | null
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
          allows_return?: boolean
          cake_role?: string | null
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
          return_price_type?: string | null
          return_value?: number | null
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
          allows_return?: boolean
          cake_role?: string | null
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
          return_price_type?: string | null
          return_value?: number | null
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
      _import_upsert_price: {
        Args: { p_price: number; p_price_list_id: string; p_product_id: string }
        Returns: number
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
      delete_demo_data: {
        Args: never
        Returns: {
          deleted_count: number
          entity: string
        }[]
      }
      extract_legal_entity_id_from_path: {
        Args: { path: string }
        Returns: string
      }
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
      has_position_in_entity: {
        Args: { p_legal_entity_id: string }
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
      is_platform_admin: { Args: never; Returns: boolean }
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
        Args: { p_counted_cash: number; p_session_id: string }
        Returns: undefined
      }
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
      pos_generate_x_report: { Args: { p_terminal_id: string }; Returns: Json }
      pos_generate_z_report: {
        Args: { p_terminal_id: string }
        Returns: string
      }
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
          p_payments: Json
          p_session_id: string
        }
        Returns: string
      }
      pos_set_operator_pin: {
        Args: { p_new_pin: string; p_operator_id: string }
        Returns: undefined
      }
      pos_verify_journal_chain: {
        Args: { p_terminal_id: string }
        Returns: {
          broken_at_id: number
          is_valid: boolean
          total_events: number
        }[]
      }
      save_matrix_changes: {
        Args: { p_changes: Json; p_customer_id: string }
        Returns: {
          lines_created: number
          lines_deleted: number
          lines_updated: number
          orders_created: number
          orders_deleted: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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

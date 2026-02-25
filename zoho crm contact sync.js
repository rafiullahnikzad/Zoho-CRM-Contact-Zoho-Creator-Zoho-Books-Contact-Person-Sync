void automation.Create_contact_in_creator(Int contact_id)
{
    // ============================================================
    // STEP 1: Fetch the Contact record from Zoho CRM by contact_id
    // ============================================================
    Get_contact = zoho.crm.getRecordById("Contacts", contact_id);
    info "Get_contact -------->" + Get_contact;

    // Extract first and last name for reuse across Creator and Books
    first_name = ifnull(Get_contact.get("First_Name"), "");
    last_name = ifnull(Get_contact.get("Last_Name"), "");
    email = ifnull(Get_contact.get("Email"), "");

    // ============================================================
    // STEP 2: Build the Creator contact map with all CRM fields
    // ============================================================
    Con_map = Map();
    Con_map.put("Contact_Id", contact_id);                                          // CRM Contact ID for future reference
    Con_map.put("Name", {"first_name":first_name, "last_name":last_name});          // Full name as Creator name field
    Con_map.put("Email", email);                                                     // Email address
    Con_map.put("Phone", ifnull(Get_contact.get("Phone"), ""));                     // Phone number
    Con_map.put("Lead_Source", ifnull(Get_contact.get("Lead_Source"), ""));         // Lead source
    Con_map.put("Job_Title", ifnull(Get_contact.get("Job_Title"), ""));             // Job title
    Con_map.put("Mobile", ifnull(Get_contact.get("Mobile"), ""));                   // Mobile number
    Con_map.put("Department", ifnull(Get_contact.get("Department"), ""));           // Department
    Con_map.put("Description", ifnull(Get_contact.get("Description"), ""));         // Description / notes
    Con_map.put("Portal_active", ifnull(Get_contact.get("Portal_Active"), ""));     // Portal access flag

    // Build address sub-map using shipping address fields from CRM
    add_Map = Map();
    add_Map.put("address_line_1", ifnull(Get_contact.get("Shipping_Address"), ""));
    add_Map.put("postal_Code", ifnull(Get_contact.get("Shipping_Zip"), ""));
    add_Map.put("district_city", ifnull(Get_contact.get("Shipping_City"), ""));
    add_Map.put("State_province", ifnull(Get_contact.get("Shipping_State"), ""));
    add_Map.put("Shipping_Country", ifnull(Get_contact.get("Shipping_Country"), ""));
    Con_map.put("Address", add_Map);                                                // Attach address map to contact map

    // ============================================================
    // STEP 3: Link Creator Account if contact has a parent Account
    // Also fetch Books_Contact_Id from the CRM Account record
    // ============================================================
    Books_Contact_Id = "";  // Initialize to empty to avoid null errors later

    if(Get_contact.get("Account_Name") != null)
    {
        // Get the account name from the CRM lookup field
        Account_Name = Get_contact.get("Account_Name").get("name");

        // Search for the matching account in Creator report
        filter = "Name == \"" + Account_Name + "\"";
        search_account = zoho.creator.getRecords("bairquality", "project-management", "Contacts_for_Admins", filter, 1, 200, "creator1");

        if(search_account.get("code") == 3000)
        {
            // Account found in Creator → link it to the contact
            account_creator_ID = search_account.get("data").get(0).get("ID");
            Con_map.put("Account_Name", account_creator_ID);
            info "Linked Creator Account ID: " + account_creator_ID;
        }

        // Fetch the parent Account from CRM to get Books Contact ID
        // Books_Contact_Id is saved by Create_account_in_Creator script
        account_id = Get_contact.get("Account_Name").get("id");
        Account_get = zoho.crm.getRecordById("Accounts", account_id.toLong());
        Books_Contact_Id = ifnull(Account_get.get("Books_Contact_Id"), "");
        info "Books_Contact_Id from CRM Account: " + Books_Contact_Id;
    }

    // ============================================================
    // STEP 4: Search for this contact in Zoho Creator
    // Update if exists, Create if not
    // ============================================================
    filter = "Contact_Id == \"" + contact_id + "\"";
    info "Searching Creator with filter: " + filter;
    search_contact = zoho.creator.getRecords("bairquality", "project-management", "All_Customers", filter, 1, 200, "creator1");
    info "Creator search result: " + search_contact;

    if(search_contact.get("code") == 3000)
    {
        // Contact already exists in Creator → Update the record
        Creator_ID = search_contact.get("data").get(0).get("ID");
        info "Contact already exists in Zoho Creator ====> Updating. ID = " + Creator_ID;
        otherParams = Map();
        update_record = zoho.creator.updateRecord("bairquality", "project-management", "All_Customers", Creator_ID.toLong(), Con_map, otherParams, "creator1");
        info "Record Updated ------>" + update_record;
    }
    else
    {
        // Contact does NOT exist in Creator → Create new record
        info "Contact NOT found in Zoho Creator ====> Creating new record";
        option_MAP = Map();
        create_record = zoho.creator.createRecord("bairquality", "project-management", "Customers", Con_map, option_MAP, "creator1");
        info "Record Created ------>" + create_record;
    }

    // ============================================================
    // STEP 5: Sync Contact Person into Zoho Books
    // Only proceed if Books_Contact_Id exists on the parent Account
    // Search first by email → Update if exists, Create if not
    // ============================================================
    if(Books_Contact_Id != "" && Books_Contact_Id != null)
    {
        info "Books_Contact_Id found → Syncing contact person into Zoho Books";

        // GET all existing contact persons under this Books contact
        search_contactperson = invokeurl
        [
            url: "https://www.zohoapis.com/books/v3/contacts/" + Books_Contact_Id + "/contactpersons?organization_id=YOUR_ORG_ID"
            type: GET
            connection: "books1"
        ];
        info "Books contact persons list: " + search_contactperson;

        // Check if a contact person with the same email already exists
        existing_person_id = "";
        contact_persons_list = search_contactperson.get("contact_persons");

        if(contact_persons_list != null && contact_persons_list.size() > 0)
        {
            for each person in contact_persons_list
            {
                if(person.get("email") == email)
                {
                    // Found matching contact person by email → capture ID
                    existing_person_id = person.get("contact_person_id");
                    info "Contact person already exists in Books. ID: " + existing_person_id;
                    break;
                }
            }
        }

        // Build the contact person payload for Books API
        contact_person = Map();
        contact_person.put("contact_id", Books_Contact_Id);                        // Parent Books contact ID
        contact_person.put("first_name", first_name);                              // First name
        contact_person.put("last_name", last_name);                                // Last name
        contact_person.put("email", email);                                        // Email (used for dedup check)
        contact_person.put("department", ifnull(Get_contact.get("Department"), "")); // Department

        if(existing_person_id != "")
        {
            // Contact person exists → Update it via PUT
            info "Updating existing Books contact person ID: " + existing_person_id;
            update_contactperson = invokeurl
            [
                url: "https://www.zohoapis.com/books/v3/contacts/contactpersons/" + existing_person_id + "?organization_id=YOUR_ORG_ID"
                type: PUT
                parameters: contact_person.toString()
                connection: "books1"
            ];
            info "update_contactperson: " + update_contactperson;
        }
        else
        {
            // Contact person does NOT exist → Create new via POST
            info "Creating new Books contact person for Books_Contact_Id: " + Books_Contact_Id;
            create_contactperson = invokeurl
            [
                url: "https://www.zohoapis.com/books/v3/contacts/contactpersons?organization_id=YOUR_ORG_ID"
                type: POST
                parameters: contact_person.toString()
                connection: "books1"
            ];
            info "create_contactperson: " + create_contactperson;
        }
    }
    else
    {
        // No Books_Contact_Id found → Skip Books sync with warning
        info "Books_Contact_Id is empty → Skipping Zoho Books contact person sync. Make sure the parent Account has Books_Contact_Id field populated.";
    }
}
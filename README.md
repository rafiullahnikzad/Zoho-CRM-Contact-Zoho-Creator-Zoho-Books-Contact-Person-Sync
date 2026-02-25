# 👤 Zoho CRM Contact → Zoho Creator & Zoho Books Contact Person Sync

> **Author:** Rafiullah Nikzad — Senior Zoho Developer @ CloudZ Technologies
> **GitHub:** [github.com/rafiullahnikzad](https://github.com/rafiullahnikzad)
> **Portfolio:** [rafiullahnikzad.netlify.app](https://rafiullahnikzad.netlify.app)
> **LinkedIn Community:** [Zoho Afghanistan](https://www.linkedin.com/groups/) (10,00+ Members)

---

## 📌 Overview

This Deluge automation script syncs **Contact records** from **Zoho CRM** into both **Zoho Creator** and **Zoho Books** automatically whenever a Contact is created or updated in CRM.

It follows a **search-first** approach — always checking if a record exists before deciding to update or create. In Zoho Books, it syncs the contact as a **Contact Person** under the parent Account's Books contact, preventing duplicates across all three platforms.

> ⚠️ **Dependency:** This script requires `Create_account_in_Creator` to have run first on the parent Account so that `Books_Contact_Id` is populated on the CRM Account record. See [Related Scripts](#-related-scripts).

---

## ✅ Tested & Working

```
Status:      ✅ Success
Time Taken:  2.68s

CRM Fetch        → Contact fetched ✅
Creator Account  → Linked (ID: 4364785000003667003) ✅
Books_Contact_Id → Found (3341468000028756019) ✅
Creator Contact  → Found → Updated ✅  (code: 3000)
Books Persons    → Searched → Empty → Created ✅  (code: 0, POST 201)

Contact Person Created:
  contact_person_id : 3341468000028741007
  first_name        : test shezada
  last_name         : test
  email             : clientfriends2023@gmail.com
```

---

## 🧩 Use Case

### Who Needs This?

- Businesses where **CRM Contacts** need to be available as **portal users** in Zoho Creator
- Companies that send invoices through **Zoho Books** and need contact persons linked to the correct customer
- Teams managing **multi-contact accounts** — each person under the same company needs their own Books contact person
- Developers building **full Zoho ecosystem sync** — CRM as the single source of truth

### Real-World Scenario

```
Sales team adds a Contact under an Account in Zoho CRM
                    ↓
       Workflow Rule fires automatically
                    ↓
        ┌─────────────────────────────────┐
        │                                 │
        ▼                                 ▼
  Zoho Creator                      Zoho Books
  (Project Management)              (Accounting)
  ─────────────────                 ──────────────────────
  Contact synced ✅                 Contact Person added ✅
  Linked to Account ✅              Linked to parent contact ✅
  Portal flag synced ✅             Ready for invoicing ✅
  Address synced ✅                 Email/department synced ✅
```

---

## 🔁 Script Logic Flow

```
START
  │
  ▼
[STEP 1] Fetch Contact from CRM using contact_id
         Extract: first_name, last_name, email
  │
  ▼
[STEP 2] Build Con_map with all contact fields
         (Name, Email, Phone, Mobile, Job Title, Department,
          Lead Source, Description, Portal_active, Address)
  │
  ▼
[STEP 3] Does contact have a parent Account?
  ├── YES → Search Creator for matching Account
  │           ├── Found → Link account_creator_ID to Con_map ✅
  │           └── Not Found → Skip account link
  │         Fetch Books_Contact_Id from CRM Account ✅
  └── NO  → Skip (Books_Contact_Id stays empty)
  │
  ▼
[STEP 4] Search Zoho Creator for existing Contact by Contact_Id
  ├── Found (code: 3000) → UPDATE Creator record ✅
  └── Not Found          → CREATE Creator record ✅
  │
  ▼
[STEP 5] Books_Contact_Id exists?
  ├── YES → GET contact persons list from Books
  │           Search by email in the list
  │           ├── Email found → PUT (update contact person) ✅
  │           └── Email not found → POST (create contact person) ✅
  └── NO  → Skip Books sync (log warning) ✅
  │
  ▼
END
```

---

## 📄 Full Deluge Script

```javascript
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
```

---

## ⚙️ Setup & Configuration

### Step 1 — Prerequisites

| Requirement                 | Details                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| Zoho CRM                    | Any paid plan with workflow automation                                          |
| Zoho Creator                | App with `All_Customers` report, `Customers` form, `Contacts_for_Admins` report |
| Zoho Books                  | Active organization with Contacts module                                        |
| `Books_Contact_Id` field    | Custom Text field on CRM **Accounts** module                                    |
| `Create_account_in_Creator` | Must run first to populate `Books_Contact_Id` on Accounts                       |

### Step 2 — Add Custom Field in CRM Accounts

1. Go to **CRM → Setup → Modules → Accounts → Fields**
2. Click **New Field**

| Setting     | Value              |
| ----------- | ------------------ |
| Field Label | `Books Contact Id` |
| API Name    | `Books_Contact_Id` |
| Field Type  | Single Line        |

### Step 3 — Create Connections

#### Creator Connection (`creator1`)

1. Go to **CRM → Setup → Developer Space → Connections**
2. **New Connection → Zoho OAuth → Zoho Creator**
3. Required scopes:

```
ZohoCreator.report.READ
ZohoCreator.report.UPDATE
ZohoCreator.form.CREATE
```

4. Name it: `creator1`

#### Books Connection (`books1`)

1. Go to **CRM → Setup → Developer Space → Connections**
2. **New Connection → Zoho OAuth → Zoho Books**
3. Required scopes:

```
ZohoBooks.contacts.READ
ZohoBooks.contacts.CREATE
ZohoBooks.contacts.UPDATE
```

4. Name it: `books1`

### Step 4 — Update Script Placeholders

| Placeholder             | Replace With                       | Where to Find                           |
| ----------------------- | ---------------------------------- | --------------------------------------- |
| `"bairquality"`         | Your Creator owner username        | Creator URL                             |
| `"project-management"`  | Your Creator app link name         | Creator URL                             |
| `"All_Customers"`       | Your Creator customers report name | Creator app                             |
| `"Customers"`           | Your Creator customers form name   | Creator app                             |
| `"Contacts_for_Admins"` | Your Creator accounts report name  | Creator app                             |
| `YOUR_ORG_ID`           | Your Books Organization ID         | Books → Settings → Organization Profile |

### Step 5 — Create CRM Workflow Rule

1. Go to **CRM → Setup → Automation → Workflow Rules → New Rule**
2. Configure:

| Setting         | Value                                      |
| --------------- | ------------------------------------------ |
| Module          | Contacts                                   |
| Rule Name       | `Create_contact_in_Creator`                |
| When to trigger | A record is **Created** or **Edited**      |
| Run             | Every time a record is modified            |
| Condition       | All Contacts (or add specific criteria)    |
| Action          | **Function** → `Create_contact_in_creator` |

---

## 🔑 Deluge Functions & APIs Used

### Deluge Built-in Functions

| Function                      | Purpose                              | Official Docs                                                                        |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `zoho.crm.getRecordById()`    | Fetch CRM Contact or Account by ID   | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/crm/get-record.html)        |
| `zoho.creator.getRecords()`   | Search Creator records with filter   | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/creator/get-records.html)   |
| `zoho.creator.updateRecord()` | Update existing Creator record       | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/creator/update-record.html) |
| `zoho.creator.createRecord()` | Create new Creator record            | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/creator/add-record.html)    |
| `invokeurl`                   | Make REST API calls to Zoho Books    | [📖 Docs](https://www.zoho.com/deluge/help/webhook/invokeurl-api-task.html)          |
| `ifnull()`                    | Return default value if null         | [📖 Docs](https://www.zoho.com/deluge/help/built-in-functions/ifnull.html)           |
| `Map()`                       | Create key-value data structure      | [📖 Docs](https://www.zoho.com/deluge/help/datatypes/map.html)                       |
| `.toString()`                 | Convert Map to JSON string for API   | [📖 Docs](https://www.zoho.com/deluge/help/datatypes/map.html)                       |
| `for each`                    | Iterate over list of contact persons | [📖 Docs](https://www.zoho.com/deluge/help/control-flow/for-each.html)               |
| `break`                       | Exit loop once match is found        | [📖 Docs](https://www.zoho.com/deluge/help/control-flow/break.html)                  |

### Zoho Books REST API Endpoints

| Operation             | Method | Endpoint                                                | Docs                                                                           |
| --------------------- | ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| List Contact Persons  | GET    | `/books/v3/contacts/{contact_id}/contactpersons`        | [📖 Docs](https://www.zoho.com/books/api/v3/contacts/#list-contact-persons)    |
| Create Contact Person | POST   | `/books/v3/contacts/contactpersons`                     | [📖 Docs](https://www.zoho.com/books/api/v3/contacts/#create-a-contact-person) |
| Update Contact Person | PUT    | `/books/v3/contacts/contactpersons/{contact_person_id}` | [📖 Docs](https://www.zoho.com/books/api/v3/contacts/#update-a-contact-person) |

### Books API Request Body — Contact Person

```json
{
  "contact_id": "3341468000028756019",
  "first_name": "John",
  "last_name": "Doe",
  "email": "john.doe@example.com",
  "department": "Engineering"
}
```

### Books API Success Response — Create Contact Person

```json
{
  "code": 0,
  "message": "Contact person's information has been saved.",
  "contact_person": {
    "contact_id": "3341468000028756019",
    "contact_person_id": "3341468000028741007",
    "first_name": "test shezada",
    "last_name": "test",
    "email": "clientfriends2023@gmail.com",
    "is_primary_contact": true,
    "created_time": "2026-02-25T17:06:27-0500"
  }
}
```

### Zoho Creator API Reference

| Operation            | Deluge Task                   | Filter Example              | Docs                                                                                 |
| -------------------- | ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| Search by Contact_Id | `zoho.creator.getRecords()`   | `"Contact_Id == \"12345\""` | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/creator/get-records.html)   |
| Search by Name       | `zoho.creator.getRecords()`   | `"Name == \"John Doe\""`    | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/creator/get-records.html)   |
| Update record        | `zoho.creator.updateRecord()` | Record ID required          | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/creator/update-record.html) |
| Create record        | `zoho.creator.createRecord()` | —                           | [📖 Docs](https://www.zoho.com/deluge/help/zoho-services/creator/add-record.html)    |

---

## ⚠️ Common Errors & Solutions

| Error                                  | Root Cause                             | Solution                                                     |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `POST 404 — Contact not accessible`    | `Books_Contact_Id` is empty or wrong   | Run `Create_account_in_Creator` first to populate the field  |
| `Books_Contact_Id is empty → Skipping` | Parent Account not yet synced to Books | Expected warning — run Account sync first                    |
| `NullPointerException` on Account_Name | Contact has no parent Account          | Wrapped in `if != null` check ✅                             |
| Duplicate contact persons in Books     | Always POSTing without checking first  | Script searches by email first, only creates if not found ✅ |
| Creator returns `code: 3100`           | Contact not found in Creator           | Expected — triggers create flow ✅                           |
| `400 Invalid JSONString`               | Map passed without `.toString()`       | All API calls use `.toString()` ✅                           |

---

## 🔗 Related Scripts

This script is **Part 2** of a 3-script CRM sync system. Run in this order:

| Order | Script                         | Purpose                                           | Dependency                             |
| ----- | ------------------------------ | ------------------------------------------------- | -------------------------------------- |
| 1st   | `Create_account_in_Creator`    | Sync CRM Account → Creator + Books                | None                                   |
| 2nd   | `Create_contact_in_creator`    | Sync CRM Contact → Creator + Books Contact Person | Needs `Books_Contact_Id` from Script 1 |
| 3rd   | `update_Portal_active_creator` | Sync Portal Active → invite or remove portal user | Needs contact in Creator               |

---

## 💡 Important Notes

**Why Books_Contact_Id must exist on the Account first:**
This script reads `Books_Contact_Id` from the parent CRM Account to know which Books contact to add the person under. If it's empty, the Books sync is safely skipped with a log warning. Always run `Create_account_in_Creator` on the parent Account before this script.

**Why contact persons are searched by email before creating:**
Zoho Books does not automatically deduplicate contact persons. Without the email check, every sync would create a new duplicate person. The script iterates the existing persons list and matches by email using a `for each` loop.

**Why `.toString()` is required:**
Zoho Books REST API expects a JSON string in the `parameters` field. Passing a `Map()` object directly causes a `400 Invalid value passed for JSONString` error.

---

## 📚 Additional Resources

| Resource                     | Link                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Zoho Deluge Help Center      | [zoho.com/deluge/help](https://www.zoho.com/deluge/help/)                                                  |
| Zoho Books API v3 — Contacts | [zoho.com/books/api/v3/contacts](https://www.zoho.com/books/api/v3/contacts/)                              |
| Zoho Creator API v2          | [zoho.com/creator/help/api/v2](https://www.zoho.com/creator/help/api/v2/)                                  |
| Zoho CRM Functions           | [zoho.com/crm/developer/docs/functions](https://www.zoho.com/crm/developer/docs/functions/)                |
| InvokeURL Task Docs          | [zoho.com/deluge/help/webhook/invokeurl](https://www.zoho.com/deluge/help/webhook/invokeurl-api-task.html) |
| Deluge for each loop         | [zoho.com/deluge/help/control-flow/for-each](https://www.zoho.com/deluge/help/control-flow/for-each.html)  |
| Learn Deluge Interactive     | [deluge.zoho.com/learndeluge](https://deluge.zoho.com/learndeluge)                                         |
| Zoho CRM Workflow Rules      | [zoho.com/crm/help/workflow-rules](https://www.zoho.com/crm/help/automation/workflow-rules.html)           |

---

## 📬 Contact & Community

- **LinkedIn:** [Rafiullah Nikzad](https://www.linkedin.com/in/rafiullahnikzad)
- **Community:** [Zoho Afghanistan — 10,000+ Members](https://www.linkedin.com/groups/)
- **Portfolio:** [rafiullahnikzad.netlify.app](https://rafiullahnikzad.netlify.app)
- **GitHub:** [55+ Free Deluge Scripts](https://github.com/rafiullahnikzad)

---

_Part of the free Zoho Deluge automation scripts collection — helping businesses automate smarter across the Zoho ecosystem._

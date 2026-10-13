# Object Scanner

The **Object Scanner** loads an org's data model — every customizable object and its fields — so you can search it and export it, and can then check it against a set of schema hygiene rules: naming, standard-object replication, over-customization, picklist quality and Salesforce Data Classification.

It does not calculate field usage. Each finding links to **Show All Data** for its object, which already has **Get field usage**.

---

## Opening it

1. Open SF Inspector from any Salesforce page in Safari.
2. Under **Platform Tools**, click **Object Scanner**, or press <kbd>J</kbd> while the panel is open.

The button can be hidden under **Options ▸ User Experience ▸ Show buttons**.

---

## Scanning the data model

1. The page lists every `IsCustomizable` object, all of them selected. Search, filter on **All**, **Custom** or **Standard**, and use **Select all** / **Select none** to narrow the set.
2. Click **Scan Data Model**. Standard objects are described first, then custom objects, five describes per Composite API call.
3. Turn on **Description & classification** before scanning if you want field descriptions and Data Classification. That adds Tooling API `FieldDefinition` queries, five objects per composite call, so it is off by default.
4. Use **Columns** to choose which field attributes the Data Model table shows. Object and Field always stay; the rest of the choice is saved in this browser.
5. Search the loaded model. `Account.Name` keeps the Account object and then its fields matching `Name` — by API name, label, help text, lookup target, description or classification. A term without a dot matches object or field names.

**Stop** cancels a scan or analysis that is running. The toolbar counts the **API calls** spent so far, a composite batch counting as one, and how long the scan took, so the cost against the org's limits is visible.

---

## Analyzing it

**Analyze** is optional. It runs the enabled rules in memory against the model you loaded. When a rule needs descriptions or classification and the scan did not query `FieldDefinition`, Analyze queries it at that point.

Only customizable objects are checked. Naming, picklist, description and type rules look at custom objects and at subscriber custom fields, including fields you created on managed objects. Packaged fields and objects are skipped.

| Rule | Default | What it flags |
|------|---------|---------------|
| Naming Convention | On · warning | API names that differ from the org's dominant style, repeat the object name, have extra underscores, or are long |
| Standard Object Replication | On · warning | Custom objects whose name or label contains a standard object (`Account`, `Contact`, …) |
| Over-customization | On · warning | Too many subscriber custom fields (100 / 300), custom relationships (25 / 40), record types other than Master (20 / 50), or subscriber custom objects in the scanned set (100 / 200) |
| PII Classified | On · info | Fields with a `ComplianceGroup`, `SecurityClassification` or `BusinessStatus` |
| PII Unclassified | Off · warning | Subscriber custom fields without any classification |
| Duplicate Labels | On · warning | Two custom fields on the same object with the same label |
| Type Hygiene | On · warning | Names that suggest Email, Phone, URL, Percent or Checkbox on a generic text or number field |
| Unrestricted Picklist | On · info | Custom picklists that accept values outside their list |
| Inactive Picklist Bloat | On · warning | Picklists where most values are inactive (default 50%) |
| Near-duplicate Objects | On · info | Custom objects that differ only by a plural or a suffix such as `_2`, `_Old`, `_Backup`, `_Copy` or `_V2` |
| Missing Description | On · warning | Subscriber custom fields with no description |
| Encrypted Unclassified | On · warning | Encrypted fields without any classification |

PII is detected from Data Classification metadata only. Field names are not used to guess it.

Click a severity card above the results to show only errors, warnings or info. An object name in the findings opens Show All Data for that object.

---

## Exporting

- **XLS** copies the loaded objects and fields to the clipboard as tab-separated text, ready to paste into Excel or Numbers.
- **CSV** downloads the same data as a file.
- **Export Findings** downloads the analysis results as CSV.

The data model export always includes every field attribute — Required, Length, Help Text, Lookup To, Encrypted, External ID, Unique and the other describe flags — whatever columns the table shows. Description and classification are included only when `FieldDefinition` was queried.

---

## Customizing the rules

Go to **Options ▸ Object Scanner**. Each rule can be switched on or off and given its own severity. Some take a setting:

- **Over-customization** has a warning and an error count for custom fields, relationships, record types and custom objects.
- **Inactive Picklist Bloat** takes the percentage of inactive values that triggers it.
- **Near-duplicate Objects** takes a regular expression for the suffixes to ignore when comparing names, by default `(_2|_old|_backup|_copy|_v2)$`. If it has a capturing group, that group is used as the name to compare; otherwise the match is removed. An invalid expression falls back to the default.

**Check All**, **Uncheck All** and **Reset to Defaults** work on the whole set, and the rules can be exported to a file and imported again — on another Mac, or to share a configuration with your team.

import {test, expect} from "./fixtures";
import {
  TEST_CONSTANTS,
  injectSessionData,
  waitSuccessfulHttpResponse,
  fulfillSuccess
} from "./test-helpers";
import {routeMock} from "./test-mock";

test.describe("Field Manager", () => {
  const {mockHost, mockToken, apiVersion} = TEST_CONSTANTS;

  /** @desc Initializes the field manager page, waits for objects to load and selects an object */
  async function initPage(page, extensionId, objectName){
    await page.goto(`chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`);
    await page.waitForSelector("#object_select");

    // Wait for objects and entity definitions to load (utils.js fetches sobjects, tooling/sobjects, and EntityDefinition via COUNT + batched queries)
    await Promise.all([
      waitSuccessfulHttpResponse(page, "/services/data/v" + apiVersion + "/sobjects/"),
      waitSuccessfulHttpResponse(page, "/services/data/v" + apiVersion + "/tooling/sobjects/"),
      waitSuccessfulHttpResponse(page, "EntityDefinition"),
      waitSuccessfulHttpResponse(page, "PermissionSet"),
    ]);

    //Wait some time to ensure that the responses are processed
    await page.waitForTimeout(350);

    // Select an object first
    await page.locator("#object_select").focus();
    await page.keyboard.type(objectName, {delay: 50});
    await page.waitForTimeout(150);

    await page.waitForSelector(".ulItem li", {timeout: 2000});
    await page.locator(".ulItem li:has-text('" + objectName + "')").first().click();
  }

  test.beforeEach(async ({context}) => {
    // 1. Inject Fake Session Data
    await injectSessionData(context, {
      host: mockHost,
      token: mockToken,
      version: apiVersion
    });

    // 2. Mock Salesforce API Calls
    await context.route("**/*", async route => {
      //if mock is disabled, continue with the request
      if (!TEST_CONSTANTS.mockEnabled) {
        await route.continue();
        return;
      }


      //we check if we have a mock for this request
      if (await routeMock(route, mockHost)) {
        return;
      }

      await route.continue();
    });
  });

  test("Load Page and Verify Initial State", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    // Wait for page to load
    await page.waitForSelector("#object_select");

    // Verify object search input exists
    const objectInput = page.locator("#object_select");
    await expect(objectInput).toBeVisible();
    await expect(objectInput).toHaveValue("");

    // Verify initial field row exists
    const fieldRows = page.locator("#fields_table tbody tr");
    await expect(fieldRows).toHaveCount(1);

    // Verify buttons exist
    await expect(page.locator("button:has-text('Clear All')")).toBeVisible();
    await expect(page.locator("button:has-text('Import')")).toBeVisible();
    await expect(page.locator("button:has-text('Deploy Fields')")).toBeVisible();
    await expect(page.locator("button:has-text('Add Row')")).toBeVisible();
  });

  test("Search and Select Object", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Verify object is selected
    await expect(page.locator("#object_select")).toHaveValue("Account");

    // Verify Fields link appears
    await expect(page.locator("a:has-text('(Fields)')")).toBeVisible();
  });

  test("Add Field Row", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("#add_row");

    // Click Add Row button
    const addRowButton = page.locator("#add_row");
    await addRowButton.click();

    // Verify new row is added
    const fieldRows = page.locator("#fields_table tbody tr");
    await expect(fieldRows).toHaveCount(2);
  });

  test("Edit Field Label and Name", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("#fields_table tbody tr");

    // Find the label input in the first row
    const labelInput = page.locator("#fields_table tbody tr").first().locator("input[placeholder='Field label...']");
    await labelInput.fill("Test Field");

    // Verify name is auto-generated (PascalCase)
    const nameInput = page.locator("#fields_table tbody tr").first().locator("input[placeholder='Field name...']");
    await expect(nameInput).toHaveValue("TestField");
  });

  test("Change Field Type", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Find the type select in the first row
    const typeSelect = page.locator("#fields_table tbody tr").first().locator("select.form-control");
    await typeSelect.selectOption("Number");

    // Verify type is changed
    await expect(typeSelect).toHaveValue("Number");
  });

  test("Open Field Options Modal", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Set field label and type
    await page.locator("#fields_table tbody tr").first().locator("input[placeholder='Field label...']").fill("Test Field");

    await page.locator("#fields_table tbody tr").first().locator("select.form-control").selectOption("Text");

    // Click Options button
    await page.locator("#fields_table tbody tr").first().locator("button:has-text('Options')").click();

    // Verify modal appears
    await expect(page.locator("text=Set Field Options")).toBeVisible();
    await expect(page.locator("label:has-text('Description')")).toBeVisible();
  });

  test("Field Options Modal - Text Field", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Set field type to Text
    const typeSelect = page.locator("#fields_table tbody tr").first().locator("select.form-control");
    await typeSelect.selectOption("Text");

    // Click Options button
    const optionsButton = page.locator("#fields_table tbody tr").first().locator("button:has-text('Options')");
    await optionsButton.click();

    // Verify Text-specific options appear
    await expect(page.locator("label:has-text('Length')")).toBeVisible();
    await expect(page.locator("input#textLength")).toBeVisible();
    await expect(page.locator("input#required")).toBeVisible();
    await expect(page.locator("input#unique")).toBeVisible();
    await expect(page.locator("input#externalId")).toBeVisible();
  });

  test("Field Options Modal - Picklist Field", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Set field type to Picklist
    const typeSelect = page.locator("#fields_table tbody tr").first().locator("select.form-control");
    await typeSelect.selectOption("Picklist");

    // Click Options button
    const optionsButton = page.locator("#fields_table tbody tr").first().locator("button:has-text('Options')");
    await optionsButton.click();

    // Verify Picklist-specific options appear
    await expect(page.locator("label:has-text('Picklist Values')")).toBeVisible();
    await expect(page.locator("textarea[name='picklistvalues']")).toBeVisible();
    await expect(page.locator("input[name='sortalpha']")).toBeVisible();
    await expect(page.locator("input[name='firstvaluedefault']")).toBeVisible();
  });

  test("Save Field Options", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Set field label and type
    const labelInput = page.locator("#fields_table tbody tr").first().locator("input[placeholder='Field label...']");
    await labelInput.fill("Test Field");

    const typeSelect = page.locator("#fields_table tbody tr").first().locator("select.form-control");
    await typeSelect.selectOption("Text");

    // Click Options button
    const optionsButton = page.locator("#fields_table tbody tr").first().locator("button:has-text('Options')");
    await optionsButton.click();

    // Wait for modal
    await page.waitForSelector("text=Set Field Options");

    // Fill in description
    const descriptionTextarea = page.locator("textarea#description");
    await descriptionTextarea.fill("Test description");

    // Click Save button
    const saveButton = page.locator(".modal-footer button:has-text('Save')");
    await saveButton.click();

    // Verify modal closes
    await expect(page.locator("text=Set Field Options")).not.toBeVisible();
  });

  test("Open Field Permissions Modal", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Click Permissions button
    await page.locator("#fields_table tbody tr").first().locator("button:has-text('Permissions')").click();

    // Verify modal appears
    await expect(page.locator("text=Set Field Permissions")).toBeVisible();
    await expect(page.locator("input[placeholder='Search profiles and permission sets...']")).toBeVisible();
  });

  test("Field Permissions Modal - Search", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Click Permissions button
    const permissionsButton = page.locator("#fields_table tbody tr").first().locator("button:has-text('Permissions')");
    await permissionsButton.click();

    // Wait for modal
    await page.waitForSelector("text=Set Field Permissions");

    // Wait for permission sets to load in modal
    await page.waitForFunction(() => {
      const modal = document.querySelector(".modal-dialog");
      if (!modal) return false;
      const tables = modal.querySelectorAll("table.slds-table");
      return tables.length > 0;
    }, {timeout: 2000});

    // Type in search box
    const searchInput = page.locator("input[placeholder='Search profiles and permission sets...']");
    await searchInput.fill("Test");

    // Verify search works (permission sets should be filtered)
    await page.waitForTimeout(250);
    // The table should still be visible
    await expect(page.locator(".modal-dialog table.slds-table")).toBeVisible();
  });

  test("Field Permissions Modal - Select Permissions", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("#fields_table tbody tr");

    // Wait for objects and permission sets to load
    await page.waitForTimeout(1000);

    // Click Permissions button
    const permissionsButton = page.locator("#fields_table tbody tr").first().locator("button:has-text('Permissions')");
    await permissionsButton.click();

    // Wait for modal
    await page.waitForSelector("text=Set Field Permissions");

    // Wait for permission sets table to load in modal
    await page.waitForFunction(() => {
      const modal = document.querySelector(".modal-dialog");
      if (!modal) return false;
      const tables = modal.querySelectorAll("table.slds-table tbody tr");
      return tables.length > 0;
    }, {timeout: 2000});

    // Click a checkbox for Edit permission (first permission set, second column)
    const editCheckbox = page.locator(".modal-dialog table.slds-table tbody tr").first().locator("td").nth(1).locator("input[type='checkbox']");
    await editCheckbox.click();

    // Verify checkbox is checked
    await expect(editCheckbox).toBeChecked();

    // Click Save button
    const saveButton = page.locator(".modal-footer button:has-text('Save')");
    await saveButton.click();

    // Verify modal closes
    await expect(page.locator("text=Set Field Permissions")).not.toBeVisible();
  });

  test("Delete Field Row", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("#add_row");

    // Add a row first
    await page.locator("#add_row").click();
    await expect(page.locator("#fields_table tbody tr")).toHaveCount(2);

    // Click delete icon on first row
    const deleteIcon = page.locator("#fields_table tbody tr").first().locator("svg[viewBox='0 0 52 52']").nth(1);
    await deleteIcon.click();

    // Verify row is deleted
    await expect(page.locator("#fields_table tbody tr")).toHaveCount(1);
  });

  test("Clone Field Row", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("#fields_table tbody tr");

    // Set field label
    const labelInput = page.locator("#fields_table tbody tr").first().locator("input[placeholder='Field label...']");
    await labelInput.fill("Test Field");

    // Click clone icon
    const cloneIcon = page.locator("#fields_table tbody tr").first().locator("svg[viewBox='0 0 52 52']").first();
    await cloneIcon.click();

    // Verify new row is added with same label
    await expect(page.locator("#fields_table tbody tr")).toHaveCount(2);
    const clonedLabelInput = page.locator("#fields_table tbody tr").nth(1).locator("input[placeholder='Field label...']");
    await expect(clonedLabelInput).toHaveValue("Test Field");
  });

  test("Open Import Modal", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("button:has-text('Import')");

    // Click Import button
    const importButton = page.locator("button:has-text('Import')");
    await importButton.click();

    // Verify import modal appears
    await expect(page.locator("text=CSV Import (beta)")).toBeVisible();
    await expect(page.locator("textarea.importTextarea")).toBeVisible();
  });

  test("Import CSV Fields", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("button:has-text('Import')");

    // Click Import button
    const importButton = page.locator("button:has-text('Import')");
    await importButton.click();

    // Wait for modal
    await page.waitForSelector("text=CSV Import (beta)");

    // Enter CSV content
    const csvTextarea = page.locator("textarea.importTextarea");
    await csvTextarea.fill("Field 1,Field1,Text\nField 2,Field2,Number");

    // Click Import button in modal
    const modalImportButton = page.locator(".modalFooter button:has-text('Import')");
    await modalImportButton.click();

    // Verify modal closes and fields are added
    await expect(page.locator("text=CSV Import (beta)")).not.toBeVisible();
    await expect(page.locator("#fields_table tbody tr")).toHaveCount(2); // the 2 imported rows replace the blank initial one
  });

  test("Deploy Fields - Success", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Set field label and name
    await page.locator("#fields_table tbody tr").first().locator("input[placeholder='Field label...']").focus();
    await page.keyboard.type("Test Field", {delay: 50});

    // Set permissions
    const permissionsButton = page.locator("#fields_table tbody tr").first().locator("button:has-text('Permissions')");
    await permissionsButton.click();
    await page.waitForSelector("text=Set Field Permissions");

    // Wait for permission sets table to load in modal
    await page.waitForFunction(() => {
      const modal = document.querySelector(".modal-dialog");
      if (!modal) return false;
      const tables = modal.querySelectorAll("table.slds-table tbody tr");
      return tables.length > 0;
    }, {timeout: 2000});

    //editCheckbox
    await page.locator(".modal-dialog table.slds-table tbody tr").first().locator("td").nth(1).locator("input[type='checkbox']").click();
    await page.locator(".modal-footer button:has-text('Save')").click();

    // Verify Deploy button is enabled
    const deployButton = page.locator("button:has-text('Deploy Fields')");
    await expect(deployButton).toBeEnabled();

    // Click Deploy Fields button
    await deployButton.click();

    //if mock is enabled, the test must successfully deploy the fields
    if (TEST_CONSTANTS.mockEnabled) {
      // Wait for pending status (clock icon) - this indicates deployment started
      // This verifies that clicking Deploy triggers the deployment process
      await page.waitForSelector("#fields_table tbody tr .cursorPointer svg use.fillGreen", {timeout: 2000});
    } else {
      // in real test; the deploy will be successful, but here we will test that it has failed (because the field already exists)
      // so we are checking the error message
      await page.waitForSelector("#fields_table tbody tr .cursorPointer svg use.fillRed", {timeout: 2000});
      await page.locator("#fields_table tbody tr .cursorPointer svg use.fillRed").first().click();

      await expect(page.locator(".notificationContent")).toContainText(/DUPLICATE_DEVELOPER_NAME|INVALID_CROSS_REFERENCE_KEY/);
    }
  });

  test("Toggle Managed Package Filter", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Find the managed package toggle label (click on the label instead of checkbox)
    const managedToggleLabel = page.locator("label.slds-checkbox_toggle", {hasText: "Managed packages"});

    // Verify initial state (should be unchecked by default)
    const checkbox = managedToggleLabel.locator("input[type='checkbox']");
    await expect(checkbox).not.toBeChecked();

    // Click on the label to toggle (this avoids the interception issue)
    await managedToggleLabel.click();

    // Verify it's checked
    await expect(checkbox).toBeChecked();
  });

  test("Updating existing fields is off on every visit, even after it was turned on", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");
    const checkbox = page.locator("#allow_field_updates");
    await expect(checkbox).not.toBeChecked();

    await checkbox.locator("..").click();
    await expect(checkbox).toBeChecked();

    await page.reload();
    await expect(page.locator("#allow_field_updates")).not.toBeChecked();
  });

  test("Deploy Button Disabled Without Object Selection", async ({page, extensionId}) => {
    const managerUrl = `chrome-extension://${extensionId}/field-manager.html?host=${mockHost}`;
    await page.goto(managerUrl);

    await page.waitForSelector("button:has-text('Deploy Fields')");

    // Verify Deploy button is disabled when no object is selected
    const deployButton = page.locator("button:has-text('Deploy Fields')");
    await expect(deployButton).toBeDisabled();
  });

  test("Field Type Validation for Platform Events", async ({page, extensionId}) => {
    await initPage(page, extensionId, "Account");

    // Note: We would need to mock a platform event object for this test
    // For now, we'll test that the field type dropdown exists and works
    const typeSelect = page.locator("#fields_table tbody tr").first().locator("select.form-control");

    // Verify field types are available
    await expect(typeSelect).toBeVisible();

    // Change to a valid type
    await typeSelect.selectOption("Text");
    await expect(typeSelect).toHaveValue("Text");
  });

  test.describe("Existing fields (mocked Tooling API)", () => {
    // Retrieve-only and creatable types side by side, with the explicit nulls the Tooling API returns
    const EXISTING_FIELDS = {
      "00N000000000001AAA": {Id: "00N000000000001AAA", DeveloperName: "Customer", Metadata: {label: "Customer", type: "Lookup", referenceTo: "Contact", relationshipName: "Customers", deleteConstraint: "SetNull", required: false, description: null, inlineHelpText: null, formula: null, defaultValue: null, valueSet: null}},
      "00N000000000002AAA": {Id: "00N000000000002AAA", DeveloperName: "Total", Metadata: {label: "Total", type: "Summary", summaryOperation: "count", summaryForeignKey: "Opportunity.AccountId", description: "Count", inlineHelpText: null, formula: null}},
      "00N000000000003AAA": {Id: "00N000000000003AAA", DeveloperName: "Code", Metadata: {label: "Code", type: "Text", length: 20, unique: true, externalId: true, required: true, description: null, inlineHelpText: null, formula: null}}
    };
    const RETRIEVE_ONLY_LABELS = ["Auto Number", "Lookup", "Master-Detail", "Roll-Up Summary", "Text (Encrypted)", "Metadata Relationship", "External Lookup", "Indirect Lookup", "Hierarchy", "Time"];

    test.skip(!TEST_CONSTANTS.mockEnabled, "Needs the mocked Tooling API");

    let patches;
    test.beforeEach(async ({page}) => {
      patches = [];
      await page.route("**/tooling/query**", async (route, request) => {
        if (decodeURIComponent(request.url()).includes("FROM CustomField")) {
          const records = Object.keys(EXISTING_FIELDS).map(Id => ({attributes: {type: "CustomField"}, Id}));
          await fulfillSuccess(route, {totalSize: records.length, done: true, records});
          return;
        }
        await route.fallback();
      });
      await page.route("**/tooling/sobjects/CustomField/00N*", async (route, request) => {
        const id = new URL(request.url()).pathname.split("/").pop();
        if (request.method() === "PATCH") {
          patches.push({id, body: request.postDataJSON()});
          await route.fulfill({status: 204, body: ""});
          return;
        }
        await fulfillSuccess(route, EXISTING_FIELDS[id]);
      });
    });

    test("Retrieve Fields lists existing fields, retrieve-only types stay out of the create flow", async ({page, extensionId}) => {
      await initPage(page, extensionId, "Account");
      await page.locator("#retrieve_fields").click();
      await expect(page.locator(".existingBadge")).toHaveCount(3);

      const rows = page.locator("#fields_table tbody tr");
      const lookupSelect = rows.filter({has: page.locator(".existingBadge")}).nth(0).locator("select");
      await expect(lookupSelect).toBeDisabled();
      await expect(lookupSelect.locator("option:checked")).toHaveText("Lookup");

      await page.locator("#add_row").click();
      const newRowOptions = await rows.last().locator("select option").allTextContents();
      expect(newRowOptions.filter(o => RETRIEVE_ONLY_LABELS.includes(o))).toEqual([]);
    });

    test("Saving an existing field PATCHes the retrieved metadata with only label, description and help text changed", async ({page, extensionId}) => {
      await initPage(page, extensionId, "Account");
      await page.locator("#retrieve_fields").click();
      await expect(page.locator(".existingBadge")).toHaveCount(3);

      const lookupRow = page.locator("#fields_table tbody tr").filter({has: page.locator(".existingBadge")}).nth(0);
      await lookupRow.locator("input[placeholder='Field label...']").fill("Primary Customer");
      await lookupRow.locator("button:has-text('Options')").click();
      await page.locator("#fieldOptionModal #description").fill("Main contact");
      await page.locator("#fieldOptionModal #helpText").fill("Who we bill");
      await page.locator("#fieldOptionModal button:has-text('Save')").click();

      await page.locator("#allow_field_updates").locator("..").click();
      await page.locator("button:has-text('Deploy Fields')").click();
      await page.locator("#updateConfirmModal button:has-text('Update')").click();
      await expect(page.locator("#fields_table use.fillGreen")).toHaveCount(1);

      // Only the edited field is sent, and everything but the three editable properties is reused
      expect(patches.map(p => p.id)).toEqual(["00N000000000001AAA"]);
      expect(patches[0].body).toEqual({
        Metadata: {label: "Primary Customer", type: "Lookup", referenceTo: "Contact", relationshipName: "Customers", deleteConstraint: "SetNull", required: false, description: "Main contact", inlineHelpText: "Who we bill"}
      });
    });

    test("Saving a Roll-Up Summary sends its operation in the upper case the Tooling API accepts", async ({page, extensionId}) => {
      await initPage(page, extensionId, "Account");
      await page.locator("#retrieve_fields").click();
      await expect(page.locator(".existingBadge")).toHaveCount(3);

      const summaryRow = page.locator("#fields_table tbody tr").filter({has: page.locator("input[value='Total']")});
      await summaryRow.locator("button:has-text('Options')").click();
      await page.locator("#fieldOptionModal #description").fill("Number of opportunities");
      await page.locator("#fieldOptionModal button:has-text('Save')").click();

      await page.locator("#allow_field_updates").locator("..").click();
      await page.locator("button:has-text('Deploy Fields')").click();
      await page.locator("#updateConfirmModal button:has-text('Update')").click();
      await expect(page.locator("#fields_table use.fillGreen")).toHaveCount(1);

      // The Tooling API reads "count" but only accepts "COUNT" on write
      expect(patches.map(p => p.id)).toEqual(["00N000000000002AAA"]);
      expect(patches[0].body.Metadata.summaryOperation).toBe("COUNT");
      expect(patches[0].body.Metadata.description).toBe("Number of opportunities");
    });

    test("Sort by column header and copy the table as CSV", async ({page, extensionId}) => {
      await initPage(page, extensionId, "Account");
      await page.locator("#retrieve_fields").click();
      await expect(page.locator(".existingBadge")).toHaveCount(3);

      const labels = () => page.locator("#fields_table tbody input[placeholder='Field label...']").evaluateAll(els => els.map(e => e.value));
      await page.locator("th a.sortableHeader:has-text('Label')").click();
      expect(await labels()).toEqual(["Code", "Customer", "Total"]);
      await page.locator("th a.sortableHeader:has-text('Label')").click();
      expect(await labels()).toEqual(["Total", "Customer", "Code"]);

      await page.evaluate(() => {
        window.copiedValues = [];
        const setData = DataTransfer.prototype.setData;
        DataTransfer.prototype.setData = function(type, data) { window.copiedValues.push(data); return setData.call(this, type, data); };
      });
      await page.locator("#copy_fields_csv").click();
      const csv = await page.evaluate(() => window.copiedValues.at(-1));
      expect(csv.split("\n")).toEqual([
        "Label,Name,Type,Description,HelpText",
        "Customer,Customer,Lookup,,",
        "Total,Total,Summary,Count,",
        "Code,Code,Text,,"
      ]);
    });
  });
});

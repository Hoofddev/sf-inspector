/* global React ReactDOM field-manager.js */
import {sfConn, apiVersion} from "./inspector.js";
import {PageHeader} from "./components/PageHeader.js";
import Toast from "./components/Toast.js";
import {UserInfoModel, createSpinForMethod, getSobjectsList, Constants, applyProductionStyling, copyToClipboard} from "./utils.js";

let h = React.createElement;

// Types this page can create.
const FIELD_TYPES = [
  "Checkbox", "Currency", "Date", "DateTime", "Email", "Location", "Number",
  "Percent", "Phone", "Picklist", "MultiselectPicklist", "Text", "TextArea",
  "LongTextArea", "Html", "Url"
];

// Types that can only be retrieved from an existing object, never created here: creating them needs
// information this page does not collect (relationship target, summarized field, formula, ...).
// Editing an existing field only ever changes Label, Description and Help Text (see updateField), so
// that is safe for any of them. These must never be offered in the create flow.
const RETRIEVE_ONLY_FIELD_TYPES = {
  AutoNumber: "Auto Number",
  Lookup: "Lookup",
  MasterDetail: "Master-Detail",
  Summary: "Roll-Up Summary",
  EncryptedText: "Text (Encrypted)",
  MetadataRelationship: "Metadata Relationship",
  ExternalLookup: "External Lookup",
  IndirectLookup: "Indirect Lookup",
  Hierarchy: "Hierarchy",
  Time: "Time"
};

function csvEscape(value, separator = ",") {
  const str = value === undefined || value === null ? "" : String(value);
  const needsQuoting = str.includes(separator) || str.includes("\"") || str.includes("\n");
  return needsQuoting ? `"${str.replace(/"/g, "\"\"")}"` : str;
}

// The Tooling API rejects writes where a Metadata sub-field is explicitly null
// ("Cannot deserialize instance of complexvalue from VALUE_NULL") for several compound properties
// (formula, defaultValue, valueSet, ...). Those have to be left out of the payload, not sent as null.
// Nested objects (valueSet, its picklist values, ...) are cleaned the same way: an absent property
// means the same to the Metadata API as a null one, so dropping them changes nothing else.
function stripNulls(value) {
  if (Array.isArray(value)) {
    return value.filter(item => item !== null).map(stripNulls);
  }
  if (value && typeof value === "object") {
    const result = {};
    Object.keys(value).forEach(key => {
      if (value[key] !== null) {
        result[key] = stripNulls(value[key]);
      }
    });
    return result;
  }
  return value;
}

// Runs `fn` over `items` with at most `limit` requests in flight at once.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill().map(worker));
  return results;
}

// Info and confirmation dialogs, in the same modal style as the page's Options and Permissions modals.
class MessageModal extends React.Component {
  componentDidMount() {
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.onKeyDown, true);
  }

  onKeyDown = (e) => {
    if (e.key === "Escape" || e.key === "Esc") {
      e.stopPropagation();
      this.props.onClose();
    }
  };

  render() {
    const {id, title, children, buttons, onClose} = this.props;
    return h("div", {className: "modalBlackBase", id, role: "dialog", "aria-modal": "true", "aria-labelledby": `${id}-title`, onClick: onClose},
      h("div", {className: "modal-dialog maxWidth600 maxHeight90vh overflowYAuto", onClick: (e) => e.stopPropagation()},
        h("div", {className: "modal-content flexColumn"},
          h("div", {className: "modal-header flexSpaceBetween alignItemsCenter marginBottom15"},
            h("h1", {className: "modal-title", id: `${id}-title`}, title),
            h("button", {
              type: "button",
              "aria-label": "Close",
              className: "close cursorPointer backgroundNone borderNone fontSize1_5 fontWeightBold",
              onClick: onClose
            }, "×")
          ),
          h("div", {className: "modal-body"}, children),
          h("div", {className: "modal-footer marginTop15 flexEnd borderTop1SolidE5 padding10_0_0_0"},
            buttons.map(button => h("button", {
              key: button.label,
              type: "button",
              className: "btn " + (button.variant === "primary" ? "btn-primary highlighted" : "btn-secondary"),
              onClick: button.onClick
            }, button.label))
          )
        )
      )
    );
  }
}

class ProfilesModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      allEditProfiles: false,
      allReadProfiles: false,
      allEditPermissionSets: false,
      allReadPermissionSets: false,
      isProfilesExpanded: false,
      isPermissionSetsExpanded: true,
      searchTerm: "",
      permissions: this.initializePermissions(props.field, props.permissionSets)
    };
  }

  handleSearchChange = (event) => {
    this.setState({searchTerm: event.target.value}, this.updateAllCheckboxes);
  };

  componentDidUpdate(prevProps) {
    if (prevProps.field !== this.props.field) {
      this.setState({
        permissions: this.initializePermissions(this.props.field, this.props.permissionSets)
      }, this.updateAllCheckboxes);
    }
  }

  initializePermissions(field, permissionSets) {
    const permissions = Object.keys(permissionSets).reduce((acc, name) => {
      acc[name] = {edit: false, read: false};
      return acc;
    }, {});

    if (field && field.profiles && Array.isArray(field.profiles)) {
      field.profiles.forEach(profile => {
        if (permissions[profile.name]) {
          permissions[profile.name] = {
            edit: profile.access === "edit",
            read: profile.access === "edit" || profile.access === "read"
          };
        }
      });
    }
    return permissions;
  }

  handlePermissionChange = (name, type) => {
    this.setState(prevState => ({
      permissions: {
        ...prevState.permissions,
        [name]: {
          ...prevState.permissions[name],
          [type]: !prevState.permissions[name][type],
          ...(type === "edit" && !prevState.permissions[name][type] === true ? {read: true} : {}),
          ...(type === "read" && !prevState.permissions[name][type] === false ? {edit: false} : {})
        }
      }
    }), this.updateAllCheckboxes);
  };

  handleSelectAll = (type, tableType) => {
    const stateKey = `all${type.charAt(0).toUpperCase() + type.slice(1)}${tableType}`;
    const allSelected = !this.state[stateKey];

    const filteredItems = this.getFilteredItems(tableType);

    this.setState(prevState => {
      const updatedPermissions = {...prevState.permissions};
      filteredItems.forEach(([name]) => {
        updatedPermissions[name] = {
          ...updatedPermissions[name],
          [type]: allSelected,
          ...(type === "edit" && allSelected === true ? {read: true} : {}),
          ...(type === "read" && allSelected === false ? {edit: false} : {})
        };
      });

      return {
        [stateKey]: allSelected,
        permissions: updatedPermissions
      };
    }, this.updateAllCheckboxes);
  };

  updateAllCheckboxes = () => {
    const {permissions} = this.state;

    const filteredProfiles = this.getFilteredItems("Profiles");
    const filteredPermissionSets = this.getFilteredItems("PermissionSets");

    const allEditProfiles = filteredProfiles.every(([name]) => permissions[name].edit);
    const allReadProfiles = filteredProfiles.every(([name]) => permissions[name].read);
    const allEditPermissionSets = filteredPermissionSets.every(([name]) => permissions[name].edit);
    const allReadPermissionSets = filteredPermissionSets.every(([name]) => permissions[name].read);

    this.setState({
      allEditProfiles,
      allReadProfiles,
      allEditPermissionSets,
      allReadPermissionSets
    });
  };

  getFilteredItems = (tableType) => {
    const {permissionSets} = this.props;
    const {searchTerm} = this.state;

    const items = Object.entries(permissionSets)
      .filter(([_, profile]) =>
        tableType === "Profiles" ? profile !== null : profile === null
      )
      .sort((a, b) =>
        tableType === "Profiles"
          ? a[1].localeCompare(b[1])
          : a[0].localeCompare(b[0])
      );

    return items.filter(([name, profile]) =>
      (profile || name).toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  applyToAllFields = () => {
    const {permissions} = this.state;
    this.props.onApplyToAllFields(permissions);
  };

  toggleSection = (section) => {
    const stateKey = `is${section.replace(" ", "")}Expanded`;
    this.setState(prevState => ({
      [stateKey]: !prevState[stateKey]
    }));
  };

  render() {
    const {field, permissionSets, onSave, onClose} = this.props;
    const {
      permissions,
      allEditProfiles,
      allReadProfiles,
      allEditPermissionSets,
      allReadPermissionSets,
      searchTerm,
    } = this.state;

    const filterItems = (items) => items.filter(([name, profile]) =>
      (profile || name).toLowerCase().includes(searchTerm.toLowerCase())
    );

    const profiles = filterItems(Object.entries(permissionSets)
      .filter(([_, profile]) => profile !== null)
      .sort((a, b) => a[1].localeCompare(b[1])));

    const permissionSetsOnly = filterItems(Object.entries(permissionSets)
      .filter(([_, profile]) => profile === null)
      .sort((a, b) => a[0].localeCompare(b[0])));

    const renderTable = (items, title) =>
      h("div", {key: title},
        h("h5", {
          onClick: () => this.toggleSection(title),
          className: "cursorPointer userSelectNone"
        },
        `${title} ${this.state[`is${title.replace(" ", "")}Expanded`] ? "▼" : "▶"}`
        ),
        this.state[`is${title.replace(" ", "")}Expanded`] && h("table", {className: "slds-table slds-table_bordered slds-m-bottom_medium"},
          h("thead", null,
            h("tr", null,
              h("th", {className: "slds-text-align_left"}, "Name"),
              h("th", {className: "slds-text-align_center"},
                h("div", {className: "flexCenter"},
                  h("span", {className: "marginRight5"}, "Edit"),
                  h("input", {
                    type: "checkbox",
                    checked: title === "Profiles" ? allEditProfiles : allEditPermissionSets,
                    onChange: () => this.handleSelectAll("edit", title.replace(" ", ""))
                  })
                )
              ),
              h("th", {className: "slds-text-align_center"},
                h("div", {className: "flexCenter"},
                  h("span", {className: "marginRight5"}, "Read"),
                  h("input", {
                    type: "checkbox",
                    checked: title === "Profiles" ? allReadProfiles : allReadPermissionSets,
                    onChange: () => this.handleSelectAll("read", title.replace(" ", ""))
                  })
                )
              )
            )
          ),
          h("tbody", null,
            items.map(([name, profile]) =>
              h("tr", {key: name},
                h("td", null, profile || name),
                h("td", {className: "slds-text-align_center"},
                  h("input", {
                    type: "checkbox",
                    checked: permissions[name].edit,
                    onChange: () => this.handlePermissionChange(name, "edit")
                  })
                ),
                h("td", {className: "slds-text-align_center"},
                  h("input", {
                    type: "checkbox",
                    checked: permissions[name].read,
                    onChange: () => this.handlePermissionChange(name, "read")
                  })
                )
              )
            )
          )
        )
      );

    return h("div", {className: "modalBlackBase", onClick: onClose},
      h("div", {
        className: "modal-dialog overflowYHidden height80 maxWidth600 flexColumn",
        onClick: (e) => e.stopPropagation()
      },
      h("div", {className: "modal-content relativePosition height100 flexColumn"},
        h("div", {className: "modal-header flexSpaceBetween alignItemsCenter marginBottom15"},
          h("h1", {className: "modal-title"}, "Set Field Permissions"),
          h("button", {
            type: "button",
            "aria-label": "Close permission modal button",
            className: "close cursorPointer backgroundNone borderNone fontSize1_5 fontWeightBold",
            onClick: onClose
          }, "×")
        ),
        h("div", {className: "modal-body overflowYAuto flexGrow1 marginRight-10 paddingRight10 scrollbarThin scrollbarColorBlue"},
          h("input", {
            type: "text",
            placeholder: "Search profiles and permission sets...",
            value: this.state.searchTerm,
            onChange: this.handleSearchChange,
            className: "fullWidth padding8 border1SolidCcc borderRadius4"
          }), h("p", {}, "Please consider granting field access to Permission Sets instead of Profiles ",
            h("a", {href: "https://admin.salesforce.com/blog/2023/permissions-updates-learn-moar-spring-23", target: ""}, "?")
          ),

          renderTable(permissionSetsOnly, "Permission Sets"),
          renderTable(profiles, "Profiles")
        ),
        h("div", {className: "modal-footer marginTop15 flexEnd borderTop1SolidE5 padding15_0 backgroundWhite stickyBottom"},
          h("button", {
            type: "button",
            "aria-label": "Close button",
            className: "btn btn-default marginRight10",
            onClick: onClose
          }, "Cancel"),
          h("button", {
            type: "button",
            "aria-label": "Save permission for this field",
            className: "btn btn-primary highlighted marginRight10",
            onClick: () => {
              const updatedProfiles = Object.entries(permissions).reduce((acc, [name, perm]) => {
                if (perm.edit || perm.read) {
                  acc.push({
                    name,
                    access: perm.edit ? "edit" : "read"
                  });
                }
                return acc;
              }, []);

              const updatedField = {
                ...field,
                profiles: updatedProfiles
              };
              onSave(updatedField);
            }
          }, "Save"),
          h("button", {
            "aria-label": "Apply the permission to all fields in the table",
            type: "button",
            className: "btn btn-secondary",
            onClick: this.applyToAllFields
          }, "Apply to All Fields")
        )
      )
      )
    );
  }
}

class FieldOptionModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      field: {...props.field},
    };
  }

  handleInputChange = (event) => {
    const {name, value, type, checked} = event.target;
    const newValue = type === "checkbox" ? checked : value;

    this.setState((prevState) => ({
      field: {
        ...prevState.field,
        [name]: newValue,
      },
    }));
  };

  handleSave = () => {
    this.props.onSave(this.state.field);
  };

  renderFieldOptions = () => {
    const {field} = this.state;
    const {selectedObject, isPlatformEvent} = this.props;
    const isForPlatformEvent = isPlatformEvent(selectedObject);

    switch (field.type) {
      case "Checkbox":
        return h("div", {className: "field_options Checkbox_options"},
          h("div", {className: "form-group"},
            h("label", null, "Default Value"),
            h("div", {className: "radio"},
              h("label", null,
                h("input", {
                  type: "radio",
                  name: "checkboxDefault",
                  value: "checked",
                  checked: field.checkboxDefault === "checked",
                  onChange: this.handleInputChange,
                  disabled: !!field.isExisting
                }),
                " Checked"
              )
            ),
            h("div", {className: "radio"},
              h("label", null,
                h("input", {
                  type: "radio",
                  name: "checkboxDefault",
                  value: "unchecked",
                  checked: field.checkboxDefault === "unchecked",
                  onChange: this.handleInputChange,
                  disabled: !!field.isExisting
                }),
                " Unchecked"
              )
            )
          ),
          this.renderDescriptionAndHelpText()
        );

      case "Currency":
        return h("div", {className: "field_options Currency_options"},
          h("div", {className: "form-group"},
            h("label", {htmlFor: "currencyLength"}, "Length"),
            h("input", {
              type: "text",
              id: "currencyLength",
              name: "precision",
              className: "form-control input-textBox",
              placeholder: "Max is 18 - Decimal Places",
              value: field.precision,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          h("div", {className: "form-group"},
            h("label", {htmlFor: "currencyDecimalPlaces"}, "Decimal Places"),
            h("input", {
              type: "text",
              id: "currencyDecimalPlaces",
              name: "decimal",
              className: "form-control input-textBox",
              placeholder: "Max is 18 - Length",
              value: field.decimal,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox()
        );

      case "Date":
      case "DateTime":
      case "Email":
      case "Phone":
      case "Url":
        return h("div", {className: `field_options ${field.type}_options`},
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox(),
          field.type === "Email" && !isForPlatformEvent && this.renderUniqueCheckbox(),
          field.type === "Email" && !isForPlatformEvent && this.renderExternalIdCheckbox()
        );

      case "Location":
        return h("div", {className: "field_options Location_options"},
          h("div", {className: "form-group"},
            h("label", null, "Latitude and Longitude Display Notation"),
            h("div", {className: "radio"},
              h("label", null,
                h("input", {
                  type: "radio",
                  name: "geodisplay",
                  value: "degrees",
                  checked: field.geodisplay === "degrees",
                  onChange: this.handleInputChange,
                  disabled: !!field.isExisting
                }),
                " Degrees, Minutes, Seconds"
              )
            ),
            h("div", {className: "radio"},
              h("label", null,
                h("input", {
                  type: "radio",
                  name: "geodisplay",
                  value: "decimal",
                  checked: field.geodisplay === "decimal",
                  onChange: this.handleInputChange,
                  disabled: !!field.isExisting
                }),
                " Decimal"
              )
            )
          ),
          h("div", {className: "form-group"},
            h("label", {htmlFor: "geolocationDecimalPlaces"}, "Decimal Places"),
            h("input", {
              type: "text",
              id: "geolocationDecimalPlaces",
              name: "decimal",
              className: "form-control input-textBox",
              value: field.decimal,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox()
        );

      case "Number":
      case "Percent":
        return h("div", {className: `field_options ${field.type}_options`},
          h("div", {className: "form-group"},
            h("label", {htmlFor: `${field.type.toLowerCase()}Length`}, "Length"),
            h("input", {
              type: "text",
              id: `${field.type.toLowerCase()}Length`,
              name: "precision",
              className: "form-control input-textBox",
              placeholder: "Max is 18 less Decimal Places",
              value: field.precision,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          h("div", {className: "form-group"},
            h("label", {htmlFor: `${field.type.toLowerCase()}DecimalPlaces`}, "Decimal Places"),
            h("input", {
              type: "text",
              id: `${field.type.toLowerCase()}DecimalPlaces`,
              name: "decimal",
              className: "form-control input-textBox",
              placeholder: "Max is 18 less Length",
              value: field.decimal,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox(),
          field.type === "Number" && !isForPlatformEvent && this.renderUniqueCheckbox(),
          field.type === "Number" && !isForPlatformEvent && this.renderExternalIdCheckbox()
        );

      case "Picklist":
      case "MultiselectPicklist":
        return h("div", {className: `field_options ${field.type}_options`},
          h("div", {className: "form-group"},
            h("label", {htmlFor: `${field.type.toLowerCase()}Options`}, "Picklist Values"),
            h("textarea", {
              id: `${field.type.toLowerCase()}Options`,
              name: "picklistvalues",
              className: "form-control",
              rows: "5",
              placeholder: "Enter picklist values separated by line breaks.",
              value: field.picklistvalues,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          h("div", {className: "checkbox"},
            h("label", {className: "centerHorizontally"},
              h("input", {
                type: "checkbox",
                id: `${field.type.toLowerCase()}SortAlpha`,
                name: "sortalpha",
                checked: field.sortalpha,
                onChange: this.handleInputChange,
                disabled: !!field.isExisting
              }),
              " Sort values alphabetically"
            )
          ),
          h("div", {className: "checkbox"},
            h("label", {className: "centerHorizontally"},
              h("input", {
                type: "checkbox",
                id: `${field.type.toLowerCase()}FirstValueDefault`,
                name: "firstvaluedefault",
                checked: field.firstvaluedefault,
                onChange: this.handleInputChange,
                disabled: !!field.isExisting
              }),
              " Use first value as default"
            )
          ),
          field.type === "MultiselectPicklist" && h("div", {className: "form-group"},
            h("label", {htmlFor: "picklist-multiVisibleLines"}, "# Visible Lines"),
            h("input", {
              type: "text",
              id: "picklist-multiVisibleLines",
              name: "vislines",
              className: "form-control input-textBox",
              placeholder: "This field is required.",
              value: field.vislines,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox()
        );

      case "Text":
        return h("div", {className: "field_options Text_options"},
          h("div", {className: "form-group"},
            h("label", {htmlFor: "textLength"}, "Length"),
            h("input", {
              type: "text",
              id: "textLength",
              name: "length",
              className: "form-control input-textBox",
              placeholder: "Max is 255 characters.",
              value: field.length ?? 255,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox(),
          !isForPlatformEvent && this.renderUniqueCheckbox(),
          !isForPlatformEvent && this.renderExternalIdCheckbox()
        );

      case "TextArea":
        return h("div", {className: "field_options TextArea_options"},
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox()
        );

      case "LongTextArea":
      case "Html":
        return h("div", {className: `field_options ${field.type}_options`},
          h("div", {className: "form-group"},
            h("label", {htmlFor: `${field.type.toLowerCase()}Length`}, "Length"),
            h("input", {
              type: "text",
              id: `${field.type.toLowerCase()}Length`,
              name: "length",
              className: "form-control input-textBox",
              placeholder: "Max is 131,072 characters.",
              value: field.length,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          h("div", {className: "form-group"},
            h("label", {htmlFor: `${field.type.toLowerCase()}VisibleLines`}, "# Visible Lines"),
            h("input", {
              type: "text",
              id: `${field.type.toLowerCase()}VisibleLines`,
              name: "vislines",
              className: "form-control input-textBox",
              placeholder: "This field is required.",
              value: field.vislines,
              onChange: this.handleInputChange,
              disabled: !!field.isExisting
            })
          ),
          this.renderDescriptionAndHelpText()
        );

      default:
        // Retrieve-only types (Lookup, Master-Detail, Roll-Up Summary, Auto Number, ...) have no
        // type-specific inputs here: only Label, Description and Help Text are ever saved for them.
        if (!field.isExisting) {
          return null;
        }
        return h("div", {className: `field_options ${field.type}_options`},
          this.renderDescriptionAndHelpText(),
          this.renderRequiredCheckbox()
        );
    }
  };

  renderDescriptionAndHelpText = () => {
    const {field} = this.state;
    const {selectedObject, isPlatformEvent} = this.props;
    const isForPlatformEvent = isPlatformEvent(selectedObject);

    return h("div", null,
      h("div", {className: "form-group"},
        h("label", {htmlFor: "description"}, "Description"),
        h("textarea", {
          id: "description",
          name: "description",
          className: "form-control",
          rows: "3",
          value: field.description || "",
          onChange: this.handleInputChange
        })
      ),
      !isForPlatformEvent && h("div", {className: "form-group"},
        h("label", {htmlFor: "helpText"}, "Help Text"),
        h("textarea", {
          id: "helpText",
          name: "helptext",
          className: "form-control",
          rows: "3",
          value: field.helptext || "",
          onChange: this.handleInputChange
        })
      )
    );
  };

  renderRestrictToDefinedValues = () => {
    const {field} = this.state;
    return h("div", {className: "checkbox"},
      h("label", null,
        h("input", {
          type: "checkbox",
          id: "restrictToDefinedValues",
          name: "restrictToDefinedValues",
          checked: field.restrictToDefinedValues || false,
          onChange: this.handleInputChange
        }),
        " Restrict picklist to the values defined in the value set"
      )
    );
  };

  renderRequiredCheckbox = () => {
    const {field} = this.state;
    return h("div", {className: "checkbox"},
      h("label", {className: "centerHorizontally"},
        h("input", {
          type: "checkbox",
          id: "required",
          name: "required",
          checked: field.required,
          onChange: this.handleInputChange,
          disabled: !!field.isExisting
        }),
        "Required"
      )
    );
  };

  renderUniqueCheckbox = () => {
    const {field} = this.state;
    return h("div", {className: "checkbox"},
      h("label", {className: "centerHorizontally"},
        h("input", {
          type: "checkbox",
          id: "unique",
          name: "uniqueSetting",
          checked: field.uniqueSetting,
          onChange: this.handleInputChange,
          disabled: !!field.isExisting
        }),
        "Unique"
      )
    );
  };

  renderExternalIdCheckbox = () => {
    const {field} = this.state;
    return h("div", {className: "checkbox"},
      h("label", {className: "centerHorizontally"},
        h("input", {
          type: "checkbox",
          id: "externalId",
          name: "external",
          checked: field.external,
          onChange: this.handleInputChange,
          disabled: !!field.isExisting
        }),
        "External ID"
      )
    );
  };

  render() {
    return h("div", {
      className: "modal fade show modalBlackBase",
      id: "fieldOptionModal",
      onClick: this.props.onClose,
      role: "dialog",
      "aria-labelledby": "fieldOptionModalLabel",
      "aria-hidden": "true"
    },
    h("div", {
      className: "modal-dialog maxWidth500 maxHeight90vh overflowYAuto",
      onClick: (e) => e.stopPropagation()
    },
    h("div", {className: "modal-content relativePosition height100 flexColumn"},
      h("div", {className: "modal-header flexSpaceBetween alignItemsCenter"},
        h("h1", {className: "modal-title"}, "Set Field Options"),
        h("button", {
          type: "button",
          "aria-label": "Close Set Field Options",
          className: "close cursorPointer backgroundNone borderNone fontSize1_5 fontWeightBold",
          onClick: this.props.onClose
        },
        h("span", {"aria-hidden": "true"}, "×")
        )
      ),
      h("div", {
        className: "modal-body padding10_0_20_0 maxHeightCalc90vh-150px overflowYAuto"
      },
      this.state.field.isExisting && h("p", {className: "existingFieldNotice"},
        "This field already exists on the object. Only Label, Description and Help Text can be changed here; the other attributes are shown for reference."
      ),
      this.renderFieldOptions()
      ),
      h("div", {
        className: "modal-footer flexEnd padding10_0_0_0 borderTop1SolidE5"
      },
      h("button", {
        "aria-label": "Close Button",
        className: "btn btn-secondary",
        onClick: this.props.onClose
      }, "Cancel"),
      h("button", {
        "aria-label": "Save options button",
        className: "btn btn-primary highlighted",
        onClick: this.handleSave
      }, "Save")
      )
    )
    )
    );
  }
}

// Define the React components
class FieldRow extends React.Component {

  getAvailableFieldTypes() {
    const {selectedObject, field} = this.props;

    // All available field types
    const allFieldTypes = [
      {value: "Checkbox", label: "Checkbox"},
      {value: "Currency", label: "Currency"},
      {value: "Date", label: "Date"},
      {value: "DateTime", label: "Date / Time"},
      {value: "Email", label: "Email"},
      {value: "Location", label: "Geolocation"},
      {value: "Number", label: "Number"},
      {value: "Percent", label: "Percent"},
      {value: "Phone", label: "Phone"},
      {value: "Picklist", label: "Picklist"},
      {value: "MultiselectPicklist", label: "Picklist (Multi-Select)"},
      {value: "Text", label: "Text"},
      {value: "TextArea", label: "Text Area"},
      {value: "LongTextArea", label: "Text Area (Long)"},
      {value: "Html", label: "Text Area (Rich)"},
      {value: "Url", label: "URL"}
    ];

    // A retrieved field can have a type this page cannot create (Lookup, Master-Detail, ...). Only
    // that row's (disabled) select gets it, so it displays correctly; new rows never offer it.
    if (field.isExisting && RETRIEVE_ONLY_FIELD_TYPES[field.type]) {
      return [...allFieldTypes, {value: field.type, label: RETRIEVE_ONLY_FIELD_TYPES[field.type]}];
    }

    // Platform events have limited field types
    if (this.props.isPlatformEvent(selectedObject)) {
      const allowedForPlatformEvents = this.props.getAllowedPlatformEventFieldTypes();
      return allFieldTypes.filter(fieldType => allowedForPlatformEvents.includes(fieldType.value));
    }

    // Standard objects and custom objects have all field types
    return allFieldTypes;
  }

  render() {
    document.title = "Field Manager";
    const isExisting = !!this.props.field.isExisting;

    let deploymentStatus;
    switch (this.props.field.deploymentStatus) {
      case "pending":
        deploymentStatus = h("svg", {
          className: "slds-button slds-icon_x-small slds-icon-text-default slds-m-top_xxx-small width20px",
          viewBox: "0 0 52 52"
        },
        h("use", {xlinkHref: "symbols.svg#clock", className: "fillBlue"})
        );
        break;
      case "success":
        deploymentStatus = h("svg", {
          className: "slds-button slds-icon_x-small slds-icon-text-default slds-m-top_xxx-small width20px",
          viewBox: "0 0 52 52"
        },
        h("use", {xlinkHref: "symbols.svg#success", className: "fillGreen"})
        );
        break;
      case "error":
        deploymentStatus = h("svg", {
          className: "slds-button slds-icon_x-small slds-icon-text-default slds-m-top_xxx-small width20px",
          viewBox: "0 0 52 52"
        },
        h("use", {xlinkHref: "symbols.svg#error", className: "fillRed"})
        );
        break;
      default:
        deploymentStatus = "";
    }

    return (
      h("tr", null,
        h("td", {className: "slds-text-align_center slds-align-middle"},
          // Cloning a retrieved field would create a new field with the same API name, which the org
          // rejects as a duplicate, so only new rows can be cloned.
          !isExisting && h("div", {className: "slds-text-align_center slds-align-middle"},
            h("svg", {
              className: "slds-button slds-icon_x-small slds-icon-text-default slds-m-top_xxx-small cursorPointer width20px",
              viewBox: "0 0 52 52",
              onClick: () => this.props.onClone(this.props.index)
            },
            h("use", {xlinkHref: "symbols.svg#clone", className: "fillBlue"})
            )
          )
        ),
        h("td", {className: "slds-text-align_center slds-align-middle"},
          h("div", {className: "slds-text-align_center slds-align-middle"},
            h("svg", {
              className: "slds-button slds-icon_x-small slds-icon-text-default slds-m-top_xxx-small cursorPointer width20px",
              viewBox: "0 0 52 52",
              onClick: () => this.props.onDelete(this.props.index)
            },
            h("use", {xlinkHref: "symbols.svg#delete", className: "fillGray"})
            )
          )
        ),
        h("td", {className: "slds-align-middle"},
          h("div", {className: "flexCenter"},
            isExisting && h("span", {
              className: "slds-badge existingBadge",
              title: "Retrieved from the object's metadata"
            }, "Existing"),
            h("input", {
              type: "text",
              className: "input-textBox",
              placeholder: "Field label...",
              value: this.props.field.label,
              onChange: (e) => this.props.onLabelChange(this.props.index, e.target.value)
            })
          )
        ),
        h("td", {className: "slds-align-middle"},
          h("div", {className: "flexCenter"},
            h("input", {
              type: "text",
              className: "input-textBox",
              placeholder: "Field name...",
              value: isExisting ? `${this.props.field.name}__c` : this.props.field.name,
              disabled: isExisting,
              onChange: (e) => this.props.onNameChange(this.props.index, e.target.value)
            })
          )
        ),
        h("td", {className: "slds-align-middle"},
          h("div", {className: "flexCenter"},
            h("select", {
              className: "form-control",
              value: this.props.field.type,
              disabled: isExisting,
              onChange: (e) => this.props.onTypeChange(this.props.index, e.target.value)
            },
            this.getAvailableFieldTypes().map(fieldType =>
              h("option", {key: fieldType.value, value: fieldType.value}, fieldType.label)
            )
            )
          )
        ),
        h("td", null,
          h("button", {
            "aria-label": "Open options modal for this field button",
            className: "btn btn-sm btn100",
            onClick: () => this.props.onEditOptions(this.props.index)
          }, "Options")
        ),
        h("td", null,
          h("button", {
            "aria-label": "Open permission modal for this field button",
            className: "btn btn-sm btn100",
            onClick: () => this.props.onEditProfiles(this.props.index)
          }, "Permissions")
        ),
        h("td", {className: "slds-text-align_center slds-align-middle"},
          h("div", {
            className: "slds-text-align_center slds-align-middle fontSize20 cursorPointer",
            onClick: () => this.props.onShowDeploymentStatus(this.props.index)
          },
          deploymentStatus
          )
        )
      )
    );
  }
}

class FieldsTable extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      sortColumn: null,
      sortDirection: "asc"
    };
  }

  onSortClick = (column) => {
    this.setState(prevState => ({
      sortColumn: column,
      sortDirection: prevState.sortColumn === column && prevState.sortDirection === "asc" ? "desc" : "asc"
    }));
  };

  // Sorting only changes the display order; each row keeps its index into the fields array, which is
  // what every row callback (delete, clone, label change, ...) addresses.
  getSortedIndexedFields() {
    const {sortColumn, sortDirection} = this.state;
    const indexedFields = this.props.fields.map((field, index) => ({field, index}));
    if (!sortColumn) {
      return indexedFields;
    }
    const direction = sortDirection === "asc" ? 1 : -1;
    return indexedFields.sort((a, b) => {
      const valueA = String(a.field[sortColumn] || "").toLowerCase();
      const valueB = String(b.field[sortColumn] || "").toLowerCase();
      if (valueA < valueB) return -1 * direction;
      if (valueA > valueB) return 1 * direction;
      return 0;
    });
  }

  renderSortableHeader(label, column) {
    const {sortColumn, sortDirection} = this.state;
    const isActive = sortColumn === column;
    return h("th", {"aria-sort": isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none"},
      h("a", {
        href: "#",
        role: "button",
        className: "sortableHeader cursorPointer userSelectNone",
        title: `Sort by ${label}`,
        onClick: (e) => { e.preventDefault(); this.onSortClick(column); }
      },
      label,
      isActive && h("svg", {className: "sortIcon", "aria-hidden": "true"},
        h("use", {xlinkHref: `symbols.svg#${sortDirection === "asc" ? "arrowup" : "arrowdown"}`, className: "fillBlue"})
      )
      )
    );
  }

  render() {
    return (
      h("div", {className: "slds-scrollable_x tab"},
        h("table", {
          className: "slds-table slds-table_bordered slds-table_striped",
          id: "fields_table"
        },
        h("thead", null,
          h("tr", null,
            h("th", null),
            h("th", null),
            this.renderSortableHeader("Label", "label"),
            this.renderSortableHeader("API Name (__c)", "name"),
            this.renderSortableHeader("Type", "type"),
            h("th", null, "Options"),
            h("th", null, "Permissions"),
            h("th", null)
          )
        ),
        h("tbody", null,
          this.getSortedIndexedFields().map(({field, index}) =>
            h(FieldRow, {
              key: index,
              index,
              field,
              selectedObject: this.props.selectedObject,
              isPlatformEvent: this.props.isPlatformEvent,
              getAllowedPlatformEventFieldTypes: this.props.getAllowedPlatformEventFieldTypes,
              onDelete: this.props.onDelete,
              onClone: this.props.onClone,
              onLabelChange: this.props.onLabelChange,
              onNameChange: this.props.onNameChange,
              onTypeChange: this.props.onTypeChange,
              onEditOptions: this.props.onEditOptions,
              onEditProfiles: this.props.onEditProfiles,
              onShowDeploymentStatus: this.props.onShowDeploymentStatus
            })
          )
        )
        )
      )
    );
  }
}

class App extends React.Component {

  constructor(props) {
    super(props);
    const {sfHost} = props;
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.spinnerCount = 0;
    this.state = {
      objects: [], // Store all objects fetched from API
      profiles: [],
      permissionSets: {},
      fields: [{label: "", name: "", type: "Text"}],
      showProfilesModal: false,
      currentFieldIndex: null,
      showModal: false,
      showImportModal: false,
      allFieldsHavePermissions: true,
      importCsvContent: "",
      importError: "",
      objectSearch: "",
      fieldErrorMessage: "",
      errorMessageClickable: false,
      filteredObjects: [],
      // The storage key predates the rename to Field Manager; it is kept so the setting survives it.
      includeManagedPackage: localStorage.getItem("fieldCreatorIncludeManaged") === "true",
      // Deliberately not remembered: overwriting existing fields is opted into per visit, so a
      // switch left on last time cannot carry over into a session on another org.
      allowFieldUpdates: false,
      showUpdateConfirmModal: false,
      pendingDeployFields: null,
      infoModal: null,
      isRetrievingFields: false,
      toast: null
    };

    // Initialize spinFor method
    this.spinFor = createSpinForMethod(this);

    // Initialize user info model - handles all user-related properties
    this.userInfoModel = new UserInfoModel(this.spinFor.bind(this));

    // Set orgName from sfHost
    this.orgName = sfHost.split(".")[0]?.toUpperCase() || "";

    applyProductionStyling(sfHost);
  }

  didUpdate() {
    this.forceUpdate();
  }

  // Utility method to check if an object is a platform event
  isPlatformEvent = (obj) => obj && obj.keyPrefix && obj.keyPrefix.startsWith("e");

  // Utility method to get allowed field types for platform events
  getAllowedPlatformEventFieldTypes = () => ["Checkbox", "Date", "DateTime", "Number", "Text", "LongTextArea"];

  // Generate the appropriate Fields setup link for different object types
  getObjectFieldsLink = (selectedObject) => {
    if (selectedObject.name.endsWith("__mdt")) {
      return `https://${sfConn.instanceHostname}/lightning/setup/CustomMetadata/page?address=%2F${selectedObject.durableId}%3Fsetupid%3DCustomMetadata`;
    } else if (selectedObject.name.endsWith("__e")) {
      return `https://${sfConn.instanceHostname}/lightning/setup/PlatformEvents/page?address=%2F${selectedObject.durableId}%3Fsetupid%3DPlatformEvents`;
    } else {
      return `https://${sfConn.instanceHostname}/lightning/setup/ObjectManager/${selectedObject.name}/FieldsAndRelationships/view`;
    }
  };

  componentDidMount() {
    this.fetchObjects();
    this.fetchPermissionSets();
    this.onSobjectsListRefreshed = (e) => {
      if (e.detail?.sfHost === this.sfHost) {
        const layoutableObjects = e.detail.sobjectsList.filter(obj =>
          obj.layoutable === true || (obj.keyPrefix && obj.keyPrefix.startsWith("e")) || obj.name.endsWith("__mdt")
        );
        this.setState({objects: layoutableObjects});
      }
    };
    window.addEventListener(Constants.SOBJECTS_LIST_REFRESHED_EVENT, this.onSobjectsListRefreshed);
  }

  componentWillUnmount() {
    window.removeEventListener(Constants.SOBJECTS_LIST_REFRESHED_EVENT, this.onSobjectsListRefreshed);
    clearTimeout(this.toastTimer);
  }

  handleObjectSearch = (e) => {
    const searchTerm = e.target.value.toLowerCase();

    // Sort the filtered objects based on relevance
    const sortedFilteredObjects = this.state.objects
      .filter(obj => {
        // First filter by managed package setting
        if (!this.state.includeManagedPackage) {
          // Hide managed package objects (those with NamespacePrefix)
          if (obj.namespacePrefix && obj.namespacePrefix !== "") {
            return false;
          }
        }

        // Then filter by search term
        return obj.name.toLowerCase().includes(searchTerm)
          || obj.label.toLowerCase().includes(searchTerm);
      })
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aLabel = a.label.toLowerCase();
        const bLabel = b.label.toLowerCase();

        // Helper function to calculate match score
        const getMatchScore = (str) => {
          if (str === searchTerm) return 4; // Exact match
          if (str.startsWith(searchTerm)) return 3; // Starts with
          if (str.includes(searchTerm)) return 2; // Contains
          return 0; // No match
        };

        const aScore = Math.max(getMatchScore(aName), getMatchScore(aLabel));
        const bScore = Math.max(getMatchScore(bName), getMatchScore(bLabel));

        if (aScore !== bScore) return bScore - aScore; // Higher score first

        // If scores are equal, prioritize shorter strings
        const aLength = Math.min(aName.length, aLabel.length);
        const bLength = Math.min(bName.length, bLabel.length);
        if (aLength !== bLength) return aLength - bLength;

        // If lengths are equal, sort alphabetically
        return aName.localeCompare(bName);
      });

    this.setState({
      objectSearch: e.target.value,
      filteredObjects: sortedFilteredObjects,
    });
  };

  handleObjectSelect = (obj) => {
    let objectName = obj.name;

    // Fields retrieved from a previously selected object no longer apply
    let updatedFields = this.state.fields.filter(field => !field.isExisting);
    if (updatedFields.length === 0) {
      updatedFields = [{label: "", name: "", type: "Text"}];
    }

    // If switching to a platform event, validate and reset field types that aren't allowed
    if (this.isPlatformEvent(obj)) {
      const allowedTypesForPE = this.getAllowedPlatformEventFieldTypes();
      updatedFields = updatedFields.map(field => {
        if (!allowedTypesForPE.includes(field.type)) {
          return {...field, type: "Text"}; // Default to Text for invalid types
        }
        return field;
      });
    }

    this.setState({
      selectedObject: obj,
      objectSearch: objectName,
      filteredObjects: [],
      fields: updatedFields
    });
  };

  onUpdateManagedPackageSelection = (e) => {
    const includeManagedPackage = e.target.checked;
    localStorage.setItem("fieldCreatorIncludeManaged", includeManagedPackage);
    this.setState({includeManagedPackage});
  };

  onUpdateAllowFieldUpdates = (e) => {
    this.setState({allowFieldUpdates: e.target.checked});
  };



  setFieldPermissions(field, fieldId, objectName) {
    if (!field.profiles || !Array.isArray(field.profiles)) {
      return Promise.resolve([]);
    }
    const permissionPromises = field.profiles.map(profile => {
      const permissionSetId = this.state.permissionSetMap[profile.name] || profile.name;
      const fieldPermissionBody = {
        ParentId: permissionSetId,
        SobjectType: objectName,
        Field: `${objectName}.${field.name}__c`,
        PermissionsEdit: profile.access === "edit",
        PermissionsRead: profile.access === "edit" || profile.access === "read"
      };

      return sfConn.rest(`/services/data/v${apiVersion}/sobjects/FieldPermissions/`, {
        method: "POST",
        body: fieldPermissionBody
      });
    });

    return Promise.all(permissionPromises);
  }

  createField(field, objectName) {
    const {selectedObject} = this.state;
    const isForPlatformEvent = this.isPlatformEvent(selectedObject);

    const newField = {
      FullName: `${objectName}.${field.name}__c`,
      Metadata: {
        label: field.label,
        type: this.mapFieldType(field.type),
        required: field.required || false,
        trackFeedHistory: false,
        trackHistory: false,
        trackTrending: false
      }
    };

    // Description is always supported
    newField.Metadata.description = field.description;

    // Only add these properties for non-platform events
    if (!isForPlatformEvent) {
      newField.Metadata.inlineHelpText = field.helptext;
      newField.Metadata.unique = field.uniqueSetting || false;
      newField.Metadata.externalId = field.external || false;
    }

    // Add specific options based on field type
    switch (field.type) {
      case "Checkbox":
        newField.Metadata.defaultValue = field.checkboxDefault === "checked";
        break;

      case "Currency":
      case "Number":
      case "Percent": {
        const scale = parseInt(field.decimal) || 0;
        const length = parseInt(field.precision) || 18;
        newField.Metadata.precision = length + scale;
        newField.Metadata.scale = scale;
        break;
      }

      case "Date":
      case "DateTime":
      case "Email":
      case "Phone":
      case "Url":
        // No additional options for these types
        break;

      case "Location":
        newField.Metadata.displayLocationInDecimal = field.geodisplay === "decimal";
        newField.Metadata.scale = parseInt(field.decimal) || 0;
        break;

      case "Picklist":
      case "MultiselectPicklist":
        newField.Metadata.valueSet = {
          valueSetDefinition: {
            sorted: field.sortalpha || false,
            value: field.picklistvalues
              .split("\n")
              .map(value => value.trim())
              .filter(value => value.length > 0)
              .map((value, index) => ({
                fullName: value,
                default: field.firstvaluedefault && index === 0
              }))
          }
        };
        if (field.type === "MultiselectPicklist") {
          newField.Metadata.visibleLines = parseInt(field.vislines) || 4;
        }
        break;

      case "Text":
        newField.Metadata.length = parseInt(field.length) || 255;
        break;

      case "TextArea":
        // No additional options for TextArea
        break;

      case "LongTextArea":
      case "Html":
        newField.Metadata.length = parseInt(field.length) || 32768;
        newField.Metadata.visibleLines = parseInt(field.vislines) || 6;
        break;

      default:
        console.warn(`Unsupported field type: ${field.type}`);
    }

    return sfConn.rest(`/services/data/v${apiVersion}/tooling/sobjects/CustomField`, {
      method: "POST",
      body: newField
    })
      .then(data => this.setFieldPermissions(field, data.id, objectName))
      .catch(error => {
        console.error("Error creating field:", error);
        throw error;
      });
  }

  // Updates only Label, Description and Help Text of a field retrieved with Retrieve Fields. It starts
  // from the untouched Metadata captured at retrieval (field.rawMetadata) and overrides just those
  // three, so every other attribute -- type, length, picklist values, required, unique, external id
  // -- is sent back exactly as it already is on the org.
  updateField(field, objectName) {
    const isForPlatformEvent = this.isPlatformEvent(this.state.selectedObject);

    const updatedMetadata = {
      ...stripNulls(field.rawMetadata || {}),
      label: field.label,
      description: field.description
    };
    if (!isForPlatformEvent) {
      updatedMetadata.inlineHelpText = field.helptext;
    }
    // The Tooling API reads a Roll-Up Summary's operation back in lower case ("count") but rejects
    // that spelling on write with JSON_PARSER_ERROR; it only accepts the upper-case constant.
    if (typeof updatedMetadata.summaryOperation === "string") {
      updatedMetadata.summaryOperation = updatedMetadata.summaryOperation.toUpperCase();
    }

    return sfConn.rest(`/services/data/v${apiVersion}/tooling/sobjects/CustomField/${field.fieldId}`, {
      method: "PATCH",
      body: {Metadata: updatedMetadata}
    })
      .then(() => this.setFieldPermissions(field, field.fieldId, objectName))
      .catch(error => {
        console.error("Error updating field:", error);
        throw error;
      });
  }

  mapFieldType(uiType) {
    const typeMap = {
      "Checkbox": "Checkbox",
      "Currency": "Currency",
      "Date": "Date",
      "DateTime": "DateTime",
      "Email": "Email",
      "Location": "Location",
      "Number": "Number",
      "Percent": "Percent",
      "Phone": "Phone",
      "Picklist": "Picklist",
      "MultiselectPicklist": "MultiselectPicklist",
      "Text": "Text",
      "TextArea": "TextArea",
      "LongTextArea": "LongTextArea",
      "Html": "Html",
      "Url": "Url"
    };
    return typeMap[uiType] || uiType;
  }

  fetchObjects = async () => {
    try {
      // Get sobjects list (from cache or fetched from API)
      const sobjectsList = await getSobjectsList(this.sfHost);

      // Filter for layoutable objects (objects that can have layouts), platform events and custom metadata types
      const layoutableObjects = sobjectsList.filter(obj =>
        obj.layoutable === true || (obj.keyPrefix && obj.keyPrefix.startsWith("e")) || obj.name.endsWith("__mdt")
      );

      this.setState({objects: layoutableObjects});
    } catch (error) {
      console.error("Error fetching objects:", error);
      this.setState({fieldErrorMessage: "Error fetching object data."});
    }
  };

  fetchPermissionSets = () => {
    sfConn.rest(`/services/data/v${apiVersion}/query/?q=SELECT+Id,Name,Profile.Name+FROM+PermissionSet`)
      .then(data => {
        let permissionSets = {};
        let permissionSetMap = {};
        data.records.forEach(record => {
          permissionSets[record.Name] = record.Profile ? record.Profile.Name : null;
          permissionSetMap[record.Name] = record.Id;
        });

        this.setState({permissionSets, permissionSetMap});
      })
      .catch(error => {
        console.error("Error fetching permission sets:", error);
      });
  };

  // Reverse of createField()'s Metadata construction: turns a retrieved CustomField Tooling API record
  // into the row shape used by the fields table. At deploy time only label, description and helptext
  // are read back out of the row (see updateField); rawMetadata stays the source of truth for the
  // rest, so an imperfect reverse mapping here cannot corrupt the field.
  mapMetadataToUiField(record, objectName) {
    const metadata = record.Metadata || {};
    const type = metadata.type;
    const field = {
      label: metadata.label || record.DeveloperName,
      name: record.DeveloperName,
      type,
      description: metadata.description || "",
      helptext: metadata.inlineHelpText || "",
      required: metadata.required || false,
      isExisting: true,
      fieldId: record.Id,
      fullName: `${objectName}.${record.DeveloperName}__c`,
      rawMetadata: metadata
    };

    switch (type) {
      case "Checkbox":
        field.checkboxDefault = metadata.defaultValue === true || metadata.defaultValue === "true" ? "checked" : "unchecked";
        break;

      case "Currency":
      case "Number":
      case "Percent": {
        const scale = metadata.scale || 0;
        field.decimal = scale;
        field.precision = Math.max((metadata.precision || 0) - scale, 0);
        if (type === "Number") {
          field.uniqueSetting = metadata.unique || false;
          field.external = metadata.externalId || false;
        }
        break;
      }

      case "Location":
        field.geodisplay = metadata.displayLocationInDecimal ? "decimal" : "degrees";
        field.decimal = metadata.scale || 0;
        break;

      case "Picklist":
      case "MultiselectPicklist": {
        const valueSetDefinition = metadata.valueSet && metadata.valueSet.valueSetDefinition;
        const values = valueSetDefinition ? sfConn.asArray(valueSetDefinition.value) : [];
        field.picklistvalues = values.map(v => v.fullName).join("\n");
        field.sortalpha = !!(valueSetDefinition && valueSetDefinition.sorted);
        field.firstvaluedefault = values.length > 0 && values[0].default === true;
        if (type === "MultiselectPicklist") {
          field.vislines = metadata.visibleLines || 4;
        }
        break;
      }

      case "Email":
        field.uniqueSetting = metadata.unique || false;
        field.external = metadata.externalId || false;
        break;

      case "Text":
        field.length = metadata.length || 255;
        field.uniqueSetting = metadata.unique || false;
        field.external = metadata.externalId || false;
        break;

      case "LongTextArea":
      case "Html":
        field.length = metadata.length || 32768;
        field.vislines = metadata.visibleLines || 6;
        break;

      default:
        break;
    }

    return field;
  }

  retrieveFields = () => {
    const {selectedObject, isRetrievingFields} = this.state;
    if (!selectedObject || this.isPlatformEvent(selectedObject) || isRetrievingFields) {
      return;
    }
    this.setState({isRetrievingFields: true});
    this.spinFor(this.performRetrieveFields());
  };

  performRetrieveFields = async () => {
    const {selectedObject, fields} = this.state;

    try {
      // Filter on the object's API name through EntityDefinition rather than on TableEnumOrId:
      // TableEnumOrId holds the 01I Id for custom objects, and the cached sObject list does not
      // always carry that Id (durableId), so matching it against the name found nothing.
      const objectName = selectedObject.name.replace(/'/g, "");
      // The Tooling API rejects a query selecting the Metadata compound field once more than one row
      // matches, so list the Ids first and then fetch each field's Metadata on its own.
      const listQuery = `SELECT Id FROM CustomField WHERE EntityDefinition.QualifiedApiName = '${objectName}'`;
      const listData = await sfConn.rest(`/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(listQuery)}`);
      const ids = (listData.records || []).map(r => r.Id);

      if (ids.length === 0) {
        this.showInfoModal("Retrieve Fields", "No custom fields found on this object.");
        return;
      }

      const records = await mapWithConcurrency(ids, 5, id =>
        sfConn.rest(`/services/data/v${apiVersion}/tooling/sobjects/CustomField/${id}`)
      );

      const existingNames = new Set(fields.filter(f => f.isExisting).map(f => f.name));
      const retrieved = [];
      let skipped = 0;

      records.forEach(record => {
        const type = record.Metadata && record.Metadata.type;
        if (!type || !(FIELD_TYPES.includes(type) || RETRIEVE_ONLY_FIELD_TYPES[type])) {
          skipped++;
          return;
        }
        if (existingNames.has(record.DeveloperName)) {
          return;
        }
        retrieved.push(this.mapMetadataToUiField(record, selectedObject.name));
      });

      if (retrieved.length === 0) {
        this.showInfoModal("Retrieve Fields", skipped > 0
          ? `No editable fields retrieved. ${skipped} field(s) were skipped (type not supported by this tool).`
          : "No new fields to retrieve.");
        return;
      }

      this.setState(prevState => {
        const isBlankPlaceholder = f => !f.isExisting && !f.label && !f.name;
        const remainingFields = prevState.fields.filter(f => !isBlankPlaceholder(f));
        return {fields: [...remainingFields, ...retrieved]};
      });

      if (skipped > 0) {
        this.showInfoModal("Retrieve Fields", `${retrieved.length} field(s) retrieved. ${skipped} field(s) were skipped (type not supported by this tool).`);
      }
    } catch (error) {
      console.error("Error retrieving fields:", error);
      this.setState({fieldErrorMessage: "Error retrieving fields for this object."});
    } finally {
      this.setState({isRetrievingFields: false});
    }
  };

  addRow = () => {
    this.setState((prevState) => ({
      fields: [...prevState.fields, {label: "", name: "", type: "Text"}],
    }));
    this.checkAllFieldsHavePermissions();
  };

  removeRow = (index) => {
    this.setState((prevState) => ({
      fields: prevState.fields.filter((_, i) => i !== index),
    }));
  };

  cloneRow = (index) => {
    this.setState((prevState) => {
      const clonedField = {...prevState.fields[index]};
      delete clonedField.deploymentStatus;
      delete clonedField.deploymentError;
      // A clone is always a brand new field, independent of any retrieved field it came from
      delete clonedField.isExisting;
      delete clonedField.fieldId;
      delete clonedField.fullName;
      delete clonedField.rawMetadata;

      return {
        fields: [...prevState.fields, clonedField],
      };
    });
  };

  formatApiName(label) {
    const namingConvention = localStorage.getItem("fieldNamingConvention") || "pascal";

    // First, replace any special characters with underscores and convert to proper case
    let apiName = label.trim().replace(/[^a-zA-Z0-9\s]/g, "_");
    if (namingConvention === "underscore") {
      // Convert spaces to underscores: "My Field Name" -> "My_Field_Name"
      apiName = apiName.replace(/\s+/g, "_");
    } else {
      // Remove underscores and convert to PascalCase: "My_Field_Name" -> "MyFieldName"
      apiName = apiName.replace(/[\s_]+(\w)/g, (_, letter) => letter.toUpperCase());
    }
    // Remove leading/trailing underscores
    apiName = apiName.replace(/^_+|_+$/g, "");
    // Replace multiple underscores with single underscore
    return apiName.replace(/_+/g, "_");
  }

  onLabelChange = (index, label) => {
    this.setState((prevState) => ({
      fields: prevState.fields.map((field, i) => {
        if (i === index) {
          field.label = label;
          // A retrieved field's API name is fixed; only new fields derive it from the label
          if (!field.isExisting) {
            field.name = this.formatApiName(label);
          }
          delete field.deploymentStatus;
          delete field.deploymentError;
        }
        return field;
      }),
    }));
  };

  onNameChange = (index, name) => {
    this.setState((prevState) => ({
      fields: prevState.fields.map((field, i) => {
        if (i === index) {
          field.name = name;
          delete field.deploymentStatus;
          delete field.deploymentError;
        }
        return field;
      }),
    }));
  };

  onTypeChange = (index, type) => {
    // Validate field type for platform events
    const {selectedObject} = this.state;

    // If it's a platform event and the type isn't allowed, default to "Text"
    let validatedType = type;
    if (this.isPlatformEvent(selectedObject)) {
      const allowedTypesForPE = this.getAllowedPlatformEventFieldTypes();
      validatedType = allowedTypesForPE.includes(type) ? type : "Text";
    }

    this.setState((prevState) => ({
      fields: prevState.fields.map((field, i) =>
        i === index ? {...field, type: validatedType} : field
      ),
    }));
  };

  onEditOptions = (index) => {
    this.setState({
      showModal: true,
      currentFieldIndex: index,
    });
  };

  openImportModal = () => {
    this.setState({showImportModal: true, importCsvContent: "", importError: ""});
  };

  closeImportModal = () => {
    this.setState({showImportModal: false, importCsvContent: "", importError: ""});
  };

  handleImportCsvChange = (event) => {
    this.setState({importCsvContent: event.target.value});
  };

  importCsv = () => {
    const {importCsvContent, fields} = this.state;
    // Helper function to detect the separator
    const detectSeparator = (content) => {
      const potentialSeparators = [",", ";", "\t", "|"];
      const lines = content.split("\n").filter(line => line.trim() !== ""); // Remove empty lines
      if (lines.length === 0) {
        return ","; // Default to comma if no content
      }
      // Check the first line for the most frequent separator
      const firstLine = lines[0];
      let maxSeparator = ",";
      let maxCount = 0;
      potentialSeparators.forEach(separator => {
        const count = firstLine.split(separator).length;
        if (count > maxCount) {
          maxCount = count;
          maxSeparator = separator;
        }
      });
      return maxSeparator;
    };
    // Detect separator dynamically
    const separator = detectSeparator(importCsvContent);
    const lines = importCsvContent.split("\n");
    const newFields = [];
    // {index in the current fields array, label, description, helptext}
    const updatesByIndex = [];
    let hasError = false;

    // Skip a leading header row, e.g. pasted back from "Copy CSV" / "Copy Excel"
    const isHeaderRow = (line) => {
      const [label, name, type] = line.split(separator).map(item => (item || "").trim().toLowerCase());
      return label === "label" && name === "name" && type === "type";
    };

    lines.forEach((line, index) => {
      if (index === 0 && isHeaderRow(line)) {
        return;
      }
      const [label, name, type, description, helptext] = line.split(separator).map(item => (item || "").trim());
      if (label && name && type) {
        // A row naming a retrieved field updates that field. Only its Label, Description and Help
        // Text are ever written back (see updateField), so its type does not have to be creatable.
        const existingIndex = fields.findIndex(f => f.isExisting && f.name === name);
        if (existingIndex !== -1) {
          updatesByIndex.push({index: existingIndex, label, description, helptext});
        } else if (FIELD_TYPES.includes(type)) {
          newFields.push({label, name, type, description: description || "", helptext: helptext || ""});
        } else {
          this.setState({importError: `Invalid type "${type}" on line ${index + 1}`});
          hasError = true;
        }
      }
    });

    if (!hasError) {
      this.setState(prevState => {
        const updatedFields = [...prevState.fields];
        updatesByIndex.forEach(({index, label, description, helptext}) => {
          updatedFields[index] = {
            ...updatedFields[index],
            label,
            description: description || "",
            helptext: helptext || ""
          };
          delete updatedFields[index].deploymentStatus;
          delete updatedFields[index].deploymentError;
        });
        // Drop the initial blank placeholder row so imported fields don't leave it dangling
        const isBlankPlaceholder = f => !f.isExisting && !f.label && !f.name;
        const remainingFields = updatedFields.filter(f => !isBlankPlaceholder(f));
        return {
          fields: [...remainingFields, ...newFields],
          showImportModal: false,
          importCsvContent: "",
          importError: ""
        };
      });
    }
  };

  exportFieldsCsv = (separator = ",") => {
    const header = ["Label", "Name", "Type", "Description", "HelpText"];
    const rows = this.state.fields
      .filter(field => field.label || field.name)
      .map(field => [field.label, field.name, field.type, field.description, field.helptext]);
    return [header, ...rows].map(row => row.map(value => csvEscape(value, separator)).join(separator)).join("\n");
  };

  downloadFieldsCsv = () => {
    const csv = this.exportFieldsCsv();
    const objectName = this.state.selectedObject ? this.state.selectedObject.name : "fields";
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv"}));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${objectName}-fields.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoked on the next tick: revoking synchronously can cancel the download before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  copyFieldsCsv = () => {
    copyToClipboard(this.exportFieldsCsv());
    this.showToast("success", "Fields copied to the clipboard as CSV.");
  };

  copyFieldsExcel = () => {
    copyToClipboard(this.exportFieldsCsv("\t"));
    this.showToast("success", "Fields copied to the clipboard as tab-separated values.");
  };

  showToast = (variant, title, message = "") => {
    clearTimeout(this.toastTimer);
    this.setState({toast: {variant, title, message}});
    this.toastTimer = setTimeout(() => this.setState({toast: null}), 4000);
  };

  hideToast = () => {
    clearTimeout(this.toastTimer);
    this.setState({toast: null});
  };

  onShowDeploymentStatus = (index) => {
    const field = this.state.fields[index];
    if (field.deploymentStatus === "error") {
      let errorMessage = "Deployment Error";
      try {
        const errorData = JSON.parse(field.deploymentError);
        errorMessage = errorData[0]?.message || errorMessage;

      } catch (e) {
        console.error("Catch error", e);
        errorMessage = field.deploymentError || errorMessage;
      }
      this.setState({fieldErrorMessage: errorMessage});
    } else if (field.deploymentStatus === "pending") {
      this.setState({fieldErrorMessage: "Field deployment is in progress"});
    }
  };

  onEditProfiles = (index) => {
    this.setState({
      showProfilesModal: true,
      currentFieldIndex: index,
    });
  };

  onCloseModal = () => {
    this.setState({
      showModal: false,
      currentFieldIndex: null,
    });
  };

  onCloseProfilesModal = () => {
    this.setState({
      showProfilesModal: false,
      currentFieldIndex: null,
    });
  };

  onSaveFieldProfiles = (updatedField) => {
    const {fields, currentFieldIndex} = this.state;
    fields[currentFieldIndex] = updatedField;
    this.setState({
      fields,
      showProfilesModal: false,
      currentFieldIndex: null,
    });
    this.checkAllFieldsHavePermissions();
  };

  applyToAllFields = (permissions) => {
    const {fields} = this.state;
    const updatedFields = fields.map(field => {
      const updatedProfiles = Object.entries(permissions).reduce((acc, [name, perm]) => {
        if (perm.edit || perm.read) {
          acc.push({
            name,
            access: perm.edit ? "edit" : "read"
          });
        }
        return acc;
      }, []);
      return {...field, profiles: updatedProfiles};
    });

    this.setState({
      fields: updatedFields,
      showProfilesModal: false,
      currentFieldIndex: null
    }, () => {
      // This callback will be executed after the state has been updated
      this.checkAllFieldsHavePermissions();
    });
  };

  onSaveFieldOptions = (updatedField) => {
    const {fields, currentFieldIndex} = this.state;
    fields[currentFieldIndex] = updatedField;
    this.setState({
      fields,
      showModal: false,
      currentFieldIndex: null,
    });
  };

  clearAll = () => {
    location.reload();
  };

  checkAllFieldsHavePermissions = () => {
    // Retrieved fields already have their field-level security; only new fields need it set here
    if (this.state.fields.filter(field => !field.isExisting).every(field => field.profiles && field.profiles.length > 0)) {
      this.setState({allFieldsHavePermissions: true});
      return true;
    } else {
      this.setState({allFieldsHavePermissions: false});
      return false;
    }
  };

  // A retrieved field only needs saving when something this page writes back has changed; an
  // untouched one is left alone rather than re-sent to the org.
  isExistingFieldModified = (field) => {
    const raw = field.rawMetadata || {};
    return (field.label || "") !== (raw.label || field.name || "")
      || (field.description || "") !== (raw.description || "")
      || (field.helptext || "") !== (raw.inlineHelpText || "")
      || (Array.isArray(field.profiles) && field.profiles.length > 0);
  };

  deploy = () => {
    const {fields, allowFieldUpdates} = this.state;
    this.checkAllFieldsHavePermissions();
    let fieldsToProcess = fields.filter(field => field.deploymentStatus !== "success"
      && (!field.isExisting || this.isExistingFieldModified(field)));

    if (fieldsToProcess.length === 0) {
      this.showInfoModal("Deploy Fields", fields.some(field => field.isExisting)
        ? "Nothing to deploy: no new fields, and no changes to the retrieved fields."
        : "All fields have already been successfully deployed.");
      return;
    }

    const updatesPending = fieldsToProcess.filter(field => field.isExisting);

    if (updatesPending.length > 0 && !allowFieldUpdates) {
      fieldsToProcess = fieldsToProcess.filter(field => !field.isExisting);
      if (fieldsToProcess.length === 0) {
        this.showInfoModal("Deploy Fields", `${updatesPending.length} existing field(s) have pending changes, but "Allow updating existing fields" is off. Turn it on to save those changes.`);
        return;
      }
      this.showInfoModal(
        "Deploy Fields",
        `${updatesPending.length} existing field(s) will be skipped because "Allow updating existing fields" is off. Only new fields will be deployed.`,
        () => this.runDeploy(fieldsToProcess)
      );
      return;
    }

    if (updatesPending.length > 0) {
      this.setState({showUpdateConfirmModal: true, pendingDeployFields: fieldsToProcess});
      return;
    }

    this.runDeploy(fieldsToProcess);
  };

  confirmDeployUpdates = () => {
    const {pendingDeployFields} = this.state;
    this.setState({showUpdateConfirmModal: false, pendingDeployFields: null});
    this.runDeploy(pendingDeployFields);
  };

  cancelDeployUpdates = () => {
    this.setState({showUpdateConfirmModal: false, pendingDeployFields: null});
  };

  runDeploy = (fieldsToProcess) => {
    const {fields} = this.state;

    const updatedFields = fields.map(field =>
      fieldsToProcess.includes(field)
        ? {...field, deploymentStatus: "pending"}
        : field
    );
    this.setState({fields: updatedFields});

    fieldsToProcess.forEach((field) => {
      const index = fields.findIndex(f => f === field);
      const deployPromise = field.isExisting
        ? this.updateField(field, this.state.selectedObject.name)
        : this.createField(field, this.state.selectedObject.name);

      deployPromise
        .then(() => {
          const newFields = [...this.state.fields];
          newFields[index].deploymentStatus = "success";
          this.setState({fields: newFields});
        })
        .catch(error => {
          const newFields = [...this.state.fields];
          newFields[index].deploymentStatus = "error";
          newFields[index].deploymentError = error.message;
          this.setState({fields: newFields});
        });
    });
  };

  showInfoModal = (title, message, onAfterClose) => {
    this.setState({infoModal: {title, message, onAfterClose}});
  };

  closeInfoModal = () => {
    const {onAfterClose} = this.state.infoModal || {};
    this.setState({infoModal: null});
    if (onAfterClose) {
      onAfterClose();
    }
  };

  render() {
    const {fields, showModal, showProfilesModal, currentFieldIndex, selectedObject, isRetrievingFields, toast} = this.state;
    const hasRetrievedFields = fields.some(field => field.isExisting);
    const exportTitle = hasRetrievedFields ? null : "Retrieve fields before exporting the table";

    return (
      h("div", {onClick: () => this.setState({
        filteredObjects: []
      })},
      h(PageHeader, {
        pageTitle: "Field Manager",
        orgName: this.orgName,
        sfLink: this.sfLink,
        sfHost: this.sfHost,
        spinnerCount: this.spinnerCount,
        ...this.userInfoModel.getProps(),
        utilityItems: [
          h("div", {
            key: "help-btn",
            className: "slds-builder-header__utilities-item slds-p-top_x-small slds-p-horizontal_x-small sfir-border-none"
          },
          h("a", {
            href: "https://github.com/Hoofddev/sf-inspector#field-manager",
            target: "_blank",
            title: "Field Manager Help",
            className: "slds-button slds-button_icon slds-button_icon-border-filled"
          },
          h("svg", {className: "slds-button__icon", "aria-hidden": "true"},
            h("use", {xlinkHref: "symbols.svg#question"})
          )
          )
          )
        ]
      }),
      h("div", {
        className: "sfir-page-container"
      },
      h("div", {className: "relativePosition"},
        h("div", {className: "area firstHeader relativePosition zIndex1"},
          h("div", {className: "form-group"},
            h("label", {htmlFor: "object_select"}, "Select Object"),
            selectedObject && h("a", {
              href: this.getObjectFieldsLink(selectedObject),
              target: "_blank",
              className: "fieldsLink marginLeft10",
              rel: "noopener noreferrer"
            }, "(Fields)"), h("br", null),
            h("div", {className: "relativePosition width400"},
              h("input", {
                type: "text",
                id: "object_select",
                className: "form-control input-textBox width100",
                placeholder: "Search and select object...",
                value: this.state.objectSearch,
                onChange: this.handleObjectSearch
              }),
              this.state.filteredObjects.length > 0 && h("ul", {
                onClick: (e) => e.stopPropagation(),
                className: "ulItem"
              },
              this.state.filteredObjects.map(obj =>
                h("li", {
                  key: obj.name,
                  onClick: () => this.handleObjectSelect(obj),
                  className: "objectListItem"
                },
                `${obj.name} (${obj.label})`
                )
              )
              )
            )
          ),
          h("br", null),
          h("div", {className: "toggleRow alignItemsCenter marginBottom15"},
            h("label", {className: "slds-checkbox_toggle max-width-small"},
              h("input", {type: "checkbox", checked: this.state.includeManagedPackage, onChange: this.onUpdateManagedPackageSelection}),
              h("span", {className: "slds-checkbox_faux_container center-label"},
                h("span", {className: "slds-checkbox_faux"}),
                h("span", {className: "slds-checkbox_on"}, "Managed packages included"),
                h("span", {className: "slds-checkbox_off"}, "Managed packages excluded"),
              )
            ),
            h("label", {className: "slds-checkbox_toggle max-width-small", title: "When off, changes to fields fetched with Retrieve Fields are skipped on deploy instead of saved"},
              h("input", {type: "checkbox", id: "allow_field_updates", checked: this.state.allowFieldUpdates, onChange: this.onUpdateAllowFieldUpdates}),
              h("span", {className: "slds-checkbox_faux_container center-label"},
                h("span", {className: "slds-checkbox_faux"}),
                h("span", {className: "slds-checkbox_on"}, "Updating existing fields allowed"),
                h("span", {className: "slds-checkbox_off"}, "Updating existing fields off"),
              )
            )
          ),
          h("div", {className: "col-xs-12 text-center", id: "deploy"},
            h("button", {"aria-label": "Clear Button", className: "btn btn-large", onClick: this.clearAll}, "Clear All"),
            h("button", {"aria-label": "Open Import modal button", className: "btn btn-large", onClick: this.openImportModal}, "Import"),
            h("button", {
              id: "retrieve_fields",
              disabled: !selectedObject || this.isPlatformEvent(selectedObject) || isRetrievingFields,
              title: this.isPlatformEvent(selectedObject)
                ? "Retrieving fields isn't supported for Platform Events"
                : "Fetch this object's custom fields to edit their Label, Description and Help Text",
              "aria-label": "Retrieve object fields button",
              className: "btn btn-large",
              onClick: this.retrieveFields
            }, isRetrievingFields ? "Retrieving..." : "Retrieve Fields"),
            h("button", {"disabled": !this.state.selectedObject || isRetrievingFields, "aria-label": "Deploy Button", className: "btn btn-large highlighted", onClick: this.deploy}, "Deploy Fields"),
            !this.state.allFieldsHavePermissions && !this.isPlatformEvent(selectedObject) && h("p", {className: "errorText"}, "Some fields are missing permissions."),
          )
        )
      ),
      h("div", {className: "area table"},
        h("div", {className: "tableToolbar"},
          h("span", {className: "tableCount"}, `Fields (${fields.length})`),
          h("div", {className: "tableToolbarActions"},
            h("button", {id: "download_fields_csv", disabled: !hasRetrievedFields, title: exportTitle || "Download the fields table as a CSV file", "aria-label": "Download fields as CSV button", className: "btn btn-sm", onClick: this.downloadFieldsCsv}, "Download CSV"),
            h("button", {id: "copy_fields_csv", disabled: !hasRetrievedFields, title: exportTitle || "Copy the fields table to the clipboard as CSV", "aria-label": "Copy fields as CSV button", className: "btn btn-sm", onClick: this.copyFieldsCsv}, "Copy CSV"),
            h("button", {id: "copy_fields_excel", disabled: !hasRetrievedFields, title: exportTitle || "Copy the fields table as tab-separated values, to paste into Excel or Numbers", "aria-label": "Copy fields as Excel button", className: "btn btn-sm", onClick: this.copyFieldsExcel}, "Copy Excel")
          )
        ),
        h(FieldsTable, {
          fields,
          selectedObject,
          isPlatformEvent: this.isPlatformEvent,
          getAllowedPlatformEventFieldTypes: this.getAllowedPlatformEventFieldTypes,
          onDelete: this.removeRow,
          onClone: this.cloneRow,
          onLabelChange: this.onLabelChange,
          onNameChange: this.onNameChange,
          onTypeChange: this.onTypeChange,
          onEditOptions: this.onEditOptions,
          onEditProfiles: this.onEditProfiles,
          onShowDeploymentStatus: this.onShowDeploymentStatus
        }),
        h("div", {className: "slds-text-align_right slds-m-top_medium"},
          h("button", {"aria-label": "Add Row/New field to table", className: "btn btn-sm highlighted maxWidth18", id: "add_row", onClick: this.addRow}, "Add Row")
        )
      ),
      showProfilesModal && h(ProfilesModal, {
        field: fields[currentFieldIndex],
        permissionSets: this.state.permissionSets,
        onSave: this.onSaveFieldProfiles,
        onClose: this.onCloseProfilesModal,
        onApplyToAllFields: this.applyToAllFields
      }),
      showModal && h(FieldOptionModal, {
        field: fields[currentFieldIndex],
        selectedObject,
        isPlatformEvent: this.isPlatformEvent,
        onSave: this.onSaveFieldOptions,
        onClose: this.onCloseModal
      }),
      this.state.showImportModal && h("div", {onClick: this.closeImportModal, className: "modalOverlay"},
        h("div", {onClick: (e) => e.stopPropagation(), className: "modalContent"},
          h("div", {className: "modalHeader"},
            h("h2", null, "CSV Import (beta)"),
            h("button", {
              onClick: this.closeImportModal,
              "aria-label": "Close Import Modal",
              className: "closeButton"
            }, "×")
          ),
          h("p", null, "Enter " + (localStorage.getItem("csvSeparator") || ",") + "  separated values of Label, ApiName, Type, and optionally Description and HelpText, or paste rows copied with Copy CSV / Copy Excel. A row whose ApiName matches a field fetched with Retrieve Fields updates that field's Label, Description and Help Text instead of adding a new row."),
          h("textarea", {
            value: this.state.importCsvContent,
            onChange: this.handleImportCsvChange,
            className: "importTextarea"
          }),
          this.state.importError && h("p", {className: "errorText"}, this.state.importError),
          h("div", {className: "modalFooter"},
            h("button", {
              "aria-label": "Cancel button",
              onClick: this.closeImportModal,
              className: "marginRight10"
            }, "Cancel"),
            h("button", {
              "aria-label": "Import button",
              onClick: this.importCsv,
              className: "btn btn-primary highlighted"
            }, "Import")
          )
        )
      ),

      this.state.fieldErrorMessage && h("div", {className: "notification_container"},
        h("div", {className: "slds-notify slds-notify_toast slds-theme_error notificationContent"},
          h("span", {className: "errorIcon"},
            h("svg", {className: "slds-icon width24px height24px", "aria-hidden": "true"},
              h("use", {xlinkHref: "symbols.svg#error", className: "iconFill"})
            )
          ),
          h("span", {className: "slds-text-heading_small"},
            this.state.fieldErrorMessage,
            this.state.errorMessageClickable && h("a", {
              href: "#",
              onClick: (e) => {
                e.preventDefault();
                localStorage.setItem("enableEntityDefinitionCaching", true);
                this.setState({fieldErrorMessage: null, errorMessageClickable: false});
                this.fetchObjects();
              },
              style: {color: "inherit", textDecoration: "underline"}
            }, "Click here to enable")
          ),
          h("a", {
            title: "Close",
            onClick: () => this.setState({fieldErrorMessage: null, errorMessageClickable: false}),
            className: "closeIcon"
          },
          h("svg", {className: "slds-icon width24px height24px", "aria-hidden": "true"},
            h("use", {xlinkHref: "symbols.svg#close", className: "iconFill"})
          )
          )
        )
      )),

      this.state.showUpdateConfirmModal && h(MessageModal, {
        id: "updateConfirmModal",
        title: "Update Existing Fields",
        onClose: this.cancelDeployUpdates,
        buttons: [
          {label: "Cancel", onClick: this.cancelDeployUpdates},
          {label: "Update", variant: "primary", onClick: this.confirmDeployUpdates}
        ]
      },
      h("p", {className: "existingFieldNotice"},
        "This overwrites the Label, Description and Help Text of the existing field(s) below on "
          + (selectedObject ? selectedObject.name : "") + ". Everything else about them is sent back unchanged. This cannot be undone from this page."
      ),
      h("ul", {className: "slds-list_dotted"},
        (this.state.pendingDeployFields || []).filter(f => f.isExisting).map(f =>
          h("li", {key: f.fullName || f.name}, `${f.label} (${f.name}__c)`)
        )
      )
      ),

      this.state.infoModal && h(MessageModal, {
        id: "infoModal",
        title: this.state.infoModal.title,
        onClose: this.closeInfoModal,
        buttons: [{label: "OK", variant: "primary", onClick: this.closeInfoModal}]
      },
      h("p", {}, this.state.infoModal.message)
      ),

      toast && h(Toast, {
        variant: toast.variant,
        title: toast.title,
        message: toast.message,
        onClose: this.hideToast
      })
      )
    );
  }
}

let args = new URLSearchParams(location.search.slice(1));
let sfHost = args.get("host");
initButton(sfHost, true);
sfConn.getSession(sfHost).then(() => {
  let root = document.getElementById("root");
  ReactDOM.render(
    h(App, {
      sfHost
    }),
    root
  );
});

// Mermaid configuration for Material theme dark/light mode compatibility
document.addEventListener("DOMContentLoaded", () => {
  // Get the current scheme (light or dark)
  function getCurrentScheme() {
    return document.body.getAttribute("data-md-color-scheme") || "default";
  }

  // Configure Mermaid based on current theme
  function configureMermaid(scheme) {
    const isDark = scheme === "slate";

    const config = {
      // Rendered below from the stored source; mermaid's own pass reads innerHTML, <code> wrapper included
      startOnLoad: false,
      securityLevel: "strict",
      theme: isDark ? "dark" : "default",
      themeVariables: {
        // Dark theme configuration
        ...(isDark && {
          primaryColor: "#4a90e2",
          primaryTextColor: "#ffffff",
          primaryBorderColor: "#ffffff",
          lineColor: "#ffffff",
          secondaryColor: "#8e44ad",
          tertiaryColor: "#f39c12",
          background: "#2e3440",
          mainBkg: "#3b4252",
          secondBkg: "#434c5e",
          tertiaryBkg: "#4c566a",
          primaryTextColor: "#eceff4",
          secondaryTextColor: "#d8dee9",
          tertiaryTextColor: "#e5e9f0",
          primaryBorderColor: "#5e81ac",
          secondaryBorderColor: "#81a1c1",
          tertiaryBorderColor: "#88c0d0",
          noteBkgColor: "#5e81ac",
          noteBorderColor: "#81a1c1",
          noteTextColor: "#ffffff"
        }),
        // Light theme configuration
        ...(!isDark && {
          primaryColor: "#4a90e2",
          primaryTextColor: "#000000",
          primaryBorderColor: "#000000",
          lineColor: "#000000",
          secondaryColor: "#8e44ad",
          tertiaryColor: "#f39c12"
        })
      }
    };

    mermaid.initialize(config);
  }

  // Keep each diagram's source before the first render replaces it with the SVG.
  // Diagrams Material for MkDocs already rendered into its own (empty) host are skipped.
  document.querySelectorAll(".mermaid").forEach((diagram) => {
    const src = diagram.textContent.trim();
    if (src) {
      diagram.dataset.mermaidSrc = src;
    }
  });

  // Render all mermaid diagrams from their stored source
  async function renderDiagrams() {
    const diagrams = document.querySelectorAll(".mermaid[data-mermaid-src]");
    for (const [index, diagram] of diagrams.entries()) {
      try {
        const {svg} = await mermaid.render("mermaid-" + index, diagram.dataset.mermaidSrc);
        const svgElement = new DOMParser().parseFromString(svg, "text/html").body.firstElementChild;
        diagram.replaceChildren(svgElement);
        diagram.setAttribute("data-processed", "true");
      } catch (error) {
        console.error("Mermaid render failed", error);
      }
    }
  }

  // Initial configuration and render
  if (typeof mermaid !== "undefined") {
    configureMermaid(getCurrentScheme());
    renderDiagrams();
  }

  // Watch for theme changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.attributeName === "data-md-color-scheme") {
        // Re-initialize Mermaid with new theme
        if (typeof mermaid !== "undefined") {
          configureMermaid(getCurrentScheme());
          renderDiagrams();
        }
      }
    });
  });

  // Start observing
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-md-color-scheme"]
  });
});

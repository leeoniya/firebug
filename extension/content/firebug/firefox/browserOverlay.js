/* See license.txt for terms of usage */

(function() {

// ********************************************************************************************* //
// Constants

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://firebug/fbtrace.js");
Cu.import("resource://firebug/loader.js");
var Locale = Cu.import("resource://firebug/locale.js").Locale;

// Firebug URLs used by the global menu.
var firebugURLs =
{
    main: "http://www.getfirebug.com",
    FAQ: "http://getfirebug.com/wiki/index.php/FAQ",
    docs: "http://www.getfirebug.com/docs.html",
    keyboard: "http://getfirebug.com/wiki/index.php/Keyboard_and_Mouse_Shortcuts",
    discuss: "http://groups.google.com/group/firebug",
    issues: "http://code.google.com/p/fbug/issues/list",
    donate: "http://getfirebug.com/getinvolved",
    extensions: "http://getfirebug.com/wiki/index.php/Firebug_Extensions",
    firstRunPage: "http://getfirebug.com/firstrun#Firebug "
};

// Register bundle yet before any Locale.$STR* API is used.
Locale.registerStringBundle("chrome://firebug/locale/firebug.properties");

// ********************************************************************************************* //
// Overlay Helpers

function $(id)
{
    return document.getElementById(id);
}

function $$(selector)
{
    return document.querySelectorAll(selector);
}

function $el(name, attributes, children, parent)
{
    attributes = attributes || {};

    if (!Array.isArray(children) && !parent)
    {
        parent = children;
        children = null;
    }

    // localize
    if (attributes.label)
        attributes.label = Locale.$STR(attributes.label);

    if (attributes.tooltiptext)
        attributes.tooltiptext = Locale.$STR(attributes.tooltiptext);

    // persist
    if (attributes.persist)
        updatePersistedValues(attributes);

    var el = document.createElement(name);
    for (var a in attributes)
        el.setAttribute(a, attributes[a]);

    for each(var a in children)
        el.appendChild(a);

    if (parent)
    {
        if (attributes.position)
            parent.insertBefore(el, parent.children[attributes.position - 1]);
        else
            parent.appendChild(el);

        // Mark to remove when Firebug is uninstalled.
        el.setAttribute("firebugRootNode", true);
    }

    return el;
}

function $command(id, oncommand, arg)
{
    // Wrap the command within a startFirebug call. If Firebug isn't yet loaded
    // this will force it to load.
    oncommand = "Firebug.GlobalUI.startFirebug(function(){" + oncommand + "})";
    if (arg)
        oncommand = "void function(arg){" + oncommand + "}(" + arg + ")";

    return $el("command", {
        id: id,
        oncommand: oncommand
    }, $("mainCommandSet"))
}

function $key(id, key, modifiers, command, position)
{
    var attributes = 
    {
        id: id,
        modifiers: modifiers,
        command: command,
        position: position
    };

    attributes[KeyEvent["DOM_"+key] ? "keycode" : "key"] = key;

    return $el("key", attributes, $("mainKeyset"));
}

function $menupopup(attributes, children, parent)
{
    return $el("menupopup", attributes, children, parent);
}

function $menu(attrs, children)
{
    return $el("menu", attrs, children);
}

function $menuseparator(attrs)
{
    return $el("menuseparator", attrs);
}

function $menuitem(attrs)
{
    return $el("menuitem", attrs);
}

function $splitmenu(attrs, children)
{
    return $el("splitmenu", attrs, children);
}

function $menupopupOverlay(parent, children)
{
    if (!parent)
        return;

    for (var i=0; i<children.length; i++)
    {
        var child = children[i];
        var id = child.getAttribute("insertbefore"), beforeEl;
        if (id)
            beforeEl = parent.querySelector("#" + id);

        if (!beforeEl)
        {
            id = child.getAttribute("insertafter");

            if (id)
                beforeEl = parent.querySelector("#" + id);
            if (beforeEl)
                beforeEl = beforeEl.nextSibling;
        }

        parent.insertBefore(child, beforeEl);

        // Mark the inserted node to remove it when Firebug is uninstalled.
        child.setAttribute("firebugRootNode", true);
    }
}

function $toolbarButton(id, attrs, children, defaultPos)
{
    attrs["class"] = "toolbarbutton-1 chromeclass-toolbar-additional";
    attrs.firebugRootNode = true;
    attrs.id = id;

    // in seamonkey gNavToolbox is null onload
    var button = $el("toolbarbutton", attrs, children, (gNavToolbox || $("navigator-toolbox")).palette);

    var selector = "[currentset^='" + id + ",'],[currentset*='," + id + ",'],[currentset$='," + id + "']";
    var toolbar = document.querySelector(selector);
    if (!toolbar)
        return; // todo defaultPos

    var currentset = toolbar.getAttribute("currentset").split(",");
    var i = currentset.indexOf(id) + 1;

    var len = currentset.length, beforeEl;
    while (i < len && !(beforeEl = $(currentset[i])))
        i++;

    return toolbar.insertItem(id, beforeEl);
}

// ********************************************************************************************* //
// Other Helpers

function updatePersistedValues(options)
{
    var persist = options.persist.split(",");
    var id = options.id;
    var RDF = Cc["@mozilla.org/rdf/rdf-service;1"].getService(Ci.nsIRDFService);
    var store = PlacesUIUtils.localStore; //this.RDF.GetDataSource("rdf:local-store");
    var root = RDF.GetResource("chrome://browser/content/browser.xul#" + id);

    var getPersist = function getPersist(aProperty)
    {
        var property = RDF.GetResource(aProperty);
        var target = store.GetTarget(root, property, true);

        if (target instanceof Ci.nsIRDFLiteral)
            return target.Value;
    }

    for each(var attr in persist)
    {
        var val = getPersist(attr);
        if (val)
            options[attr] = val;
    }
}

function cloneArray(arr)
{
    var newArr = [];
    for (var i=0; i<arr.length; i++)
        newArr.push(arr[i]);
    return newArr;
}

// ********************************************************************************************* //

Firebug.GlobalUI =
{
    nodesToRemove: [],

    $: $,
    $$: $$,
    $el: $el,
    $menupopupOverlay: $menupopupOverlay,
    $menuitem: $menuitem,
    $menuseparator: $menuseparator,
    $command: $command,
    $key: $key,
    $splitmenu: $splitmenu,

    $stylesheet: function(href)
    {
        var s = document.createProcessingInstruction("xml-stylesheet", 'href="' + href + '"');
        document.insertBefore(s, document.documentElement);
        this.nodesToRemove.push(s);
    },

    $script: function(src)
    {
        var script = document.createElementNS("http://www.w3.org/1999/xhtml", "html:script");
        script.src = src;
        script.type = "text/javascript";
        script.setAttribute("firebugRootNode", true);
        document.documentElement.appendChild(script);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    /**
     * This method is called by the Fremework to load entire Firebug. It's executed when
     * the user requires Firebug for the first time.
     *
     * @param {Object} callback Executed when Firebug is fully loaded
     */
    startFirebug: function(callback)
    {
        if (Firebug.waitingForFirstLoad)
            return;

        if (Firebug.isInitialized)
            return callback && callback(Firebug);

        if (FBTrace.DBG_INITIALIZE)
            FBTrace.sysout("overlay; Load Firebug...");

        Firebug.waitingForFirstLoad = true;

        var container = $("appcontent");

        // List of Firbug scripts that must be loaded into the global scope (browser.xul)
        var scriptSources = [
            "chrome://firebug/content/trace.js",
            "chrome://firebug/content/legacy.js",
            "chrome://firebug/content/moduleConfig.js"
        ]

        // Create script elements.
        scriptSources.forEach(this.$script);

        // Create Firebug splitter element.
        $el("splitter", {id: "fbContentSplitter", collapsed: "true"}, container);

        // Create Firebug main frame and container.
        $el("vbox", {id: "fbMainFrame", collapsed: "true", persist: "height,width"}, [
            $el("browser", {
                id: "fbMainContainer",
                flex: "2",
                src: "chrome://firebug/content/firefox/firebugFrame.xul",
                disablehistory: "true"
            })
        ], container);

        // When Firebug is fully loaded and initialized it fires a "FirebugLoaded"
        // event to the browser document (browser.xul scope). Wait for that to happen.
        document.addEventListener("FirebugLoaded", function onLoad()
        {
            document.removeEventListener("FirebugLoaded", onLoad, false);
            Firebug.waitingForFirstLoad = false;

            // TODO find a better place for notifying extensions
            FirebugLoader.dispatchToScopes("firebugFrameLoad", [Firebug]);
            callback && callback(Firebug);
        }, false);
    },

    onOptionsShowing: function(popup)
    {
        for (var child = popup.firstChild; child; child = child.nextSibling)
        {
            if (child.localName == "menuitem")
            {
                var option = child.getAttribute("option");
                if (option)
                {
                    var checked = FirebugLoader.getPref(option);

                    // xxxHonza: I belive that allPagesActivation could be simple boolean option.
                    if (option == "allPagesActivation")
                        checked = (checked == "on") ? true : false;

                    child.setAttribute("checked", checked);
                }
            }
        }
    },

    onToggleOption: function(menuItem)
    {
        var option = menuItem.getAttribute("option");
        var checked = menuItem.getAttribute("checked") == "true";

        FirebugLoader.setPref(option, checked);
    },

    onMenuShowing: function(popup)
    {
        var collapsed = "true";
        if (Firebug.chrome)
        {
            var fbContentBox = Firebug.chrome.$("fbContentBox");
            collapsed = fbContentBox.getAttribute("collapsed");
        }

        var currPos = FirebugLoader.getPref("framePosition");
        var placement = Firebug.getPlacement ? Firebug.getPlacement() : "";

        // Switch between "Open Firebug" and "Hide Firebug" label in the popup menu
        var toggleFirebug = popup.querySelector("#menu_toggleFirebug");
        if (toggleFirebug)
        {
            var hiddenUI = (collapsed == "true" || placement == "minimized");
            toggleFirebug.setAttribute("label", (hiddenUI ?
                Locale.$STR("firebug.ShowFirebug") : Locale.$STR("firebug.HideFirebug")));

            toggleFirebug.setAttribute("tooltiptext", (hiddenUI ?
                Locale.$STR("firebug.menu.tip.Open_Firebug") :
                Locale.$STR("firebug.menu.tip.Minimize_Firebug")));

            // If Firebug is detached, use "Focus Firebug Window" label
            if (currPos == "detached" && Firebug.currentContext)
            {
                toggleFirebug.setAttribute("label", Locale.$STR("firebug.FocusFirebug"));
                toggleFirebug.setAttribute("tooltiptext", Locale.$STR("firebug.menu.tip.Focus_Firebug"));
            }

            // Hide "Focus Firebug Window" item if the menu is opened from within
            // the detached Firebug window.
            var currentLocation = toggleFirebug.ownerDocument.defaultView.top.location.href;
            var inDetachedWindow = currentLocation.indexOf("firebug.xul") > 0;
            toggleFirebug.setAttribute("collapsed", (inDetachedWindow ? "true" : "false"));
        }

        // Hide "Deactivate Firebug" menu if Firebug is not active.
        var closeFirebug = popup.querySelector("#menu_closeFirebug");
        if (closeFirebug)
        {
            closeFirebug.setAttribute("collapsed", (Firebug.currentContext ? "false" : "true"));
        }
    },

    onPositionPopupShowing: function(popup)
    {
        while (popup.lastChild)
            popup.removeChild(popup.lastChild);

        // Load Firebug before the position is changed.
        var oncommand = "Firebug.GlobalUI.startFirebug(function(){" +
            "Firebug.chrome.setPosition('%pos%')" + "})";

        var items = [];
        var currPos = FirebugLoader.getPref("framePosition");
        for each (var pos in ["detached", "top", "bottom", "left", "right"])
        {
            var label = pos.charAt(0).toUpperCase() + pos.slice(1);
            var item = $menuitem({
                label: Locale.$STR("firebug.menu." + label),
                tooltiptext: Locale.$STR("firebug.menu.tip." + label),
                type: "radio",
                oncommand: oncommand.replace("%pos%", pos),
                checked: (currPos == pos)
            });

            if (pos == "detached")
                items.key = "key_detachFirebug";

            popup.appendChild(item);
        }

        return true;
    },

    openAboutDialog: function()
    {
        // Firefox 4.0+
        Components.utils["import"]("resource://gre/modules/AddonManager.jsm");
        AddonManager.getAddonByID("firebug@software.joehewitt.com", function(addon)
        {
            openDialog("chrome://mozapps/content/extensions/about.xul", "",
                "chrome,centerscreen,modal", addon);
        });
    },

    visitWebsite: function(which, arg)
    {
        var url = firebugURLs[which];
        if (url)
        {
            url = arg ? url + arg : url;
            gBrowser.selectedTab = gBrowser.addTab(url, null, null, null);
        }
    },

    setPosition: function(newPosition)
    {
        // todo
    },

    getVersion: function()
    {
        var versionURL = "chrome://firebug/content/branch.properties";
        var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

        var channel = ioService.newChannel(versionURL, null, null);
        var input = channel.open();
        var sis = Cc["@mozilla.org/scriptableinputstream;1"].
            createInstance(Ci.nsIScriptableInputStream);
        sis.init(input);

        var content = sis.readBytes(input.available());
        sis.close();

        var m = /RELEASE=(.*)/.exec(content);
        if (m)
            var release = m[1];
        else
            return "no RELEASE in " + versionURL;

        m = /VERSION=(.*)/.exec(content);
        if (m)
            var version = m[1];
        else
            return "no VERSION in " + versionURL;

        return version+""+release;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // External Editors

    onEditorsShowing: function(popup)
    {
        Firebug.GlobalUI.startFirebug(function()
        {
            Firebug.ExternalEditors.onEditorsShowing(popup);
        });

        return true;
    }
}

// ********************************************************************************************* //
// Global Firebug CSS

Firebug.GlobalUI.$stylesheet("chrome://firebug/content/firefox/browserOverlay.css");

// ********************************************************************************************* //
// Broadcasters

/**
 * This element (a broadcaster) is storing Firebug state information. Other elements
 * (like for example the Firebug start button) can watch it and display the info to
 * the user.
 */
$el("broadcaster", {id: "firebugStatus", suspended: true}, $("mainBroadcasterSet"));

// ********************************************************************************************* //
// Global Commands

$command("cmd_closeFirebug", "Firebug.closeFirebug(true)");
$command("cmd_toggleInspecting", "if (!Firebug.currentContext) Firebug.toggleBar(true); Firebug.Inspector.toggleInspecting(Firebug.currentContext)");
$command("cmd_focusCommandLine", "if (!Firebug.currentContext) Firebug.toggleBar(true); Firebug.CommandLine.focus(Firebug.currentContext)");
$command("cmd_toggleFirebug", "Firebug.toggleBar()");
$command("cmd_detachFirebug", "Firebug.toggleDetachBar(false, true)");
$command("cmd_inspect", "Firebug.Inspector.inspectFromContextMenu(arg)", "document.popupNode");
$command("cmd_toggleBreakOn", "if (Firebug.currentContext) Firebug.chrome.breakOnNext(Firebug.currentContext, event)");
$command("cmd_toggleDetachFirebug", "Firebug.toggleDetachBar(false, true)");
$command("cmd_increaseTextSize", "Firebug.Options.changeTextSize(1);");
$command("cmd_decreaseTextSize", "Firebug.Options.changeTextSize(-1);");
$command("cmd_normalTextSize", "Firebug.Options.setTextSize(0);");
$command("cmd_focusFirebugSearch", "if (Firebug.currentContext) Firebug.Search.onSearchCommand(document);");
$command("cmd_customizeFBKeys", "Firebug.ShortcutsModel.customizeShortcuts()");
$command("cmd_enablePanels", "Firebug.PanelActivation.enableAllPanels()");
$command("cmd_disablePanels", "Firebug.PanelActivation.disableAllPanels()");
$command("cmd_clearActivationList", "Firebug.PanelActivation.clearAnnotations()");
$command("cmd_clearConsole", "Firebug.Console.clear(Firebug.currentContext)");
$command("cmd_allOn", "Firebug.PanelActivation.toggleAll('on')");
$command("cmd_toggleOrient", ""); //todo
$command("cmd_toggleOrient", ""); //todo
$command("cmd_toggleOrient", ""); //todo
$command("cmd_toggleProfiling", ""); //todo

$command("cmd_openInEditor", "Firebug.ExternalEditors.onContextMenuCommand(event)");

// ********************************************************************************************* //
// Global Shortcuts

(function(globalShortcuts)
{
    var keyset = $("mainKeyset");

    globalShortcuts.forEach(function(id)
    {
        var shortcut = FirebugLoader.getPref("key.shortcut." + id);
        var tokens = shortcut.split(" ");
        var key = tokens.pop();

        var keyProps = {
            id: "key_" + id,
            modifiers: tokens.join(","),
            command: "cmd_" + id,
            position: 1
        };

        if (key.length <= 1)
            keyProps.key = key;
        else if (KeyEvent["DOM_"+key])
            keyProps.keycode = key;

        $el("key", keyProps, keyset);
    });

    keyset.parentNode.insertBefore(keyset, keyset.nextSibling);
})(["toggleFirebug", "toggleInspecting", "focusCommandLine",
    "detachFirebug", "closeFirebug", "toggleBreakOn"]);


/* Used by the global menu, but should be really global shortcuts?
key_increaseTextSize
key_decreaseTextSize
key_normalTextSize
key_help
key_toggleProfiling
key_focusFirebugSearch
key_customizeFBKeys
*/

// ********************************************************************************************* //
// Firebug Start Button Popup Menu

$menupopupOverlay($("mainPopupSet"), [
    $menupopup(
    {
        id: "fbStatusContextMenu",
        onpopupshowing: "Firebug.GlobalUI.onOptionsShowing(this)"
    },
    [
        $menu(
        {
            label: "firebug.uiLocation",
            tooltiptext: "firebug.menu.tip.UI_Location",
            "class": "fbInternational"
        },
        [
            $menupopup({onpopupshowing: "Firebug.GlobalUI.onPositionPopupShowing(this)"})
        ]),
        $menuseparator(),
        $menuitem({
            id: "menu_ClearConsole",
            label: "firebug.ClearConsole",
            tooltiptext: "firebug.ClearTooltip",
            command: "cmd_clearConsole",
            key: "key_clearConsole"
        }),
        $menuitem({
            id: "menu_showErrorCount",
            type: "checkbox",
            label: "firebug.Show_Error_Count",
            tooltiptext: "firebug.menu.tip.Show_Error_Count",
            oncommand: "Firebug.GlobalUI.onToggleOption(this)",
            option: "showErrorCount"
        }),
        $menuseparator(),
        $menuitem({
            id: "menu_enablePanels",
            label: "firebug.menu.Enable_All_Panels",
            tooltiptext: "firebug.menu.tip.Enable_All_Panels",
            command: "cmd_enablePanels"
        }),
        $menuitem({
            id: "menu_disablePanels",
            label: "firebug.menu.Disable_All_Panels",
            tooltiptext: "firebug.menu.tip.Disable_All_Panels",
            command: "cmd_disablePanels"
        }),
        $menuseparator(),
        $menuitem({
            id: "menu_AllOn",
            type: "checkbox",
            label: "On_for_all_web_pages",
            tooltiptext: "firebug.menu.tip.On_for_all_Web_Sites",
            command: "cmd_allOn",
            option: "allPagesActivation"
        }),
        $menuitem({
            id: "menu_clearActivationList",
            label: "firebug.menu.Clear_Activation_List",
            tooltiptext: "firebug.menu.tip.Clear_Activation_List",
            command: "cmd_clearActivationList"
        })
    ])
])

// ********************************************************************************************* //
// Firebug Global Menu

/**
 * There are more instances of Firebug Menu (e.g. one in Firefox -> Tools -> Web Developer
 * and one in Firefox 4 (top-left orange button menu) -> Web Developer
 *
 * If extensions want to override the menu thay need to iterate all existing instance
 * using document.querySelectorAll(".fbFirebugMenuPopup") and append new menu items to all
 * of them. Iteration must be done in the global space (browser.xul)
 *
 * The same menu is also used for Firebug Icon Menu (Firebug's toolbar). This menu is cloned
 * and initialized as soon as Firebug UI is actually loaded. Since it's cloned from the original
 * (global scope) extensions don't have to extend it (possible new menu items are already there).
 */
var firebugMenuPopup = $menupopup({id: "fbFirebugMenuPopup",
    "class": "fbFirebugMenuPopup",
    onpopupshowing: "return Firebug.GlobalUI.onMenuShowing(this);"}, [

    // Open/close Firebug
    $menuitem(
    {
        id: "menu_toggleFirebug",
        label: "firebug.ShowFirebug",
        tooltiptext: "firebug.menu.tip.Open_Firebug",
        command: "cmd_toggleFirebug",
        key: "key_toggleFirebug",
        "class": "fbInternational"
    }),
    $menuitem(
    {
        id: "menu_closeFirebug",
        label: "firebug.Deactivate_Firebug",
        tooltiptext: "firebug.tip.Deactivate_Firebug",
        command: "cmd_closeFirebug",
        key: "key_closeFirebug",
        "class": "fbInternational"
    }),

    // Firebug UI position
    $menu(
    {
        label: "firebug.uiLocation",
        tooltiptext: "firebug.menu.tip.UI_Location",
        "class": "fbInternational"
    },
    [
        $menupopup({onpopupshowing: "Firebug.GlobalUI.onPositionPopupShowing(this)"})
    ]),

    $menuseparator(),

    // External Editors
    $menu(
    {
        id: "FirebugMenu_OpenWith",
        label:"firebug.OpenWith",
        tooltiptext:"firebug.menu.tip.Open_With",
        "class": "fbInternational",
        insertafter: "menu_openActionsSeparator",
        openFromContext: "true",
        command: "cmd_openInEditor"
    },
    [
        $menupopup({id:"fbFirebugMenu_OpenWith",
            onpopupshowing: "return Firebug.GlobalUI.onEditorsShowing(this);"})
    ]),

    // Text Size
    $menu(
    {
        id: "FirebugMenu_TextSize",
        label: "firebug.TextSize",
        tooltiptext: "firebug.menu.tip.Text_Size",
        "class": "fbInternational"
    },
    [
        $menupopup({},
        [
            $menuitem(
            {
                id: "menu_increaseTextSize",
                label: "firebug.IncreaseTextSize",
                tooltiptext: "firebug.menu.tip.Increase_Text_Size",
                command: "cmd_increaseTextSize",
                key: "key_increaseTextSize",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_decreaseTextSize",
                label: "firebug.DecreaseTextSize",
                tooltiptext: "firebug.menu.tip.Decrease_Text_Size",
                command: "cmd_decreaseTextSize",
                key: "key_decreaseTextSize",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_normalTextSize",
                label: "firebug.NormalTextSize",
                tooltiptext: "firebug.menu.tip.Normal_Text_Size",
                command: "cmd_normalTextSize",
                key: "key_normalTextSize",
                "class": "fbInternational"
            }),
        ])
    ]),

    // Options
    $menu(
    {
        id: "FirebugMenu_Options",
        label: "firebug.Options",
        tooltiptext: "firebug.menu.tip.Options",
        "class": "fbInternational"
    },
    [
        $menupopup(
        {
            id: "FirebugMenu_OptionsPopup",
            onpopupshowing: "return Firebug.GlobalUI.onOptionsShowing(this);"
        },
        [
            $menuitem(
            {
                id: "menu_toggleShowErrorCount",
                type: "checkbox",
                label: "firebug.Show_Error_Count",
                tooltiptext: "firebug.menu.tip.Show_Error_Count",
                oncommand: "Firebug.GlobalUI.onToggleOption(this)",
                option: "showErrorCount",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_showTooltips",
                type: "checkbox",
                label: "firebug.menu.Show_Info_Tips",
                tooltiptext: "firebug.menu.tip.Show_Info_Tips",
                oncommand: "Firebug.GlobalUI.onToggleOption(this)",
                option: "showInfoTips",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_shadeBoxModel",
                type: "checkbox",
                label: "ShadeBoxModel",
                tooltiptext: "inspect.option.tip.Shade_Box_Model",
                oncommand: "Firebug.GlobalUI.onToggleOption(this)",
                option: "shadeBoxModel",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "showQuickInfoBox",
                type: "checkbox",
                label: "ShowQuickInfoBox",
                tooltiptext: "inspect.option.tip.Show_Quick_Info_Box",
                oncommand: "Firebug.GlobalUI.onToggleOption(this)",
                option: "showQuickInfoBox",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_enableA11y",
                type: "checkbox",
                label: "firebug.menu.Enable_Accessibility_Enhancements",
                tooltiptext: "firebug.menu.tip.Enable_Accessibility_Enhancements",
                oncommand: "Firebug.GlobalUI.onToggleOption(this)",
                option: "a11y.enable",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_activateSameOrigin",
                type: "checkbox",
                label: "firebug.menu.Activate_Same_Origin_URLs2",
                tooltiptext: "firebug.menu.tip.Activate_Same_Origin_URLs",
                oncommand: "Firebug.GlobalUI.onToggleOption(this)",
                option: "activateSameOrigin",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_toggleOrient",
                type: "checkbox",
                label: "firebug.menu.Vertical_Panels",
                tooltiptext: "firebug.menu.tip.Vertical_Panels",
                command: "cmd_toggleOrient",
                option: "viewPanelOrient",
                "class": "fbInternational"
            }),
            $menuseparator({id: "menu_optionsSeparator"}),
            $menuitem(
            {
                id: "menu_resetAllOptions",
                label: "firebug.menu.Reset_All_Firebug_Options",
                tooltiptext: "firebug.menu.tip.Reset_All_Firebug_Options",
                command: "cmd_resetAllOptions",
                "class": "fbInternational"
            }),
        ])
    ]),

    $menuseparator({id: "FirebugBetweenOptionsAndSites", collapsed: "true"}),

    // Sites
    $menu(
    {
        id: "FirebugMenu_Sites",
        label: "firebug.menu.Firebug_Online",
        tooltiptext: "firebug.menu.tip.Firebug_Online",
        "class": "fbInternational"
    },
    [
        $menupopup({},
        [
            $menuitem(
            {
                id: "menu_firebugUrlWebsite",
                label: "firebug.Website",
                tooltiptext: "firebug.menu.tip.Website",
                oncommand: "Firebug.GlobalUI.visitWebsite('main')",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_firebugUrlExtensions",
                label: "firebug.menu.Extensions",
                tooltiptext: "firebug.menu.tip.Extensions",
                oncommand: "Firebug.GlobalUI.visitWebsite('extensions')",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_firebugFAQ",
                label: "firebug.FAQ",
                tooltiptext: "firebug.menu.tip.FAQ",
                command: "cmd_openHelp",
                key: "key_help",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_firebugDoc",
                label: "firebug.Documentation",
                tooltiptext: "firebug.menu.tip.Documentation",
                oncommand: "Firebug.GlobalUI.visitWebsite('docs')",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_firebugKeyboard",
                label: "firebug.KeyShortcuts",
                tooltiptext: "firebug.menu.tip.Key_Shortcuts",
                oncommand: "Firebug.GlobalUI.visitWebsite('keyboard')",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_firebugForums",
                label: "firebug.Forums",
                tooltiptext: "firebug.menu.tip.Forums",
                oncommand: "Firebug.GlobalUI.visitWebsite('discuss')",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_firebugIssues",
                label: "firebug.Issues",
                tooltiptext: "firebug.menu.tip.Issues",
                oncommand: "Firebug.GlobalUI.visitWebsite('issues')",
                "class": "fbInternational"
            }),
            $menuitem(
            {
                id: "menu_firebugDonate",
                label: "firebug.Donate",
                tooltiptext: "firebug.menu.tip.Donate",
                oncommand: "Firebug.GlobalUI.visitWebsite('donate')",
                "class": "fbInternational"
            }),
        ])
    ]),

    $menuseparator({id: "menu_miscActionsSeparator", collapsed: "true"}),

    $menuseparator({id: "menu_toolsSeparator", collapsed: "true"}),

    $menuitem(
    {
        id: "menu_customizeShortcuts",
        label: "firebug.menu.Customize_shortcuts",
        tooltiptext: "firebug.menu.tip.Customize_Shortcuts",
        command: "cmd_customizeFBKeys",
        key: "key_customizeFBKeys",
        "class": "fbInternational"
    }),

    $menuseparator({id: "menu_aboutSeparator"}),

    $menuitem({
        id: "Firebug_About",
        label: "firebug.About",
        tooltiptext: "firebug.menu.tip.About",
        oncommand: "Firebug.GlobalUI.openAboutDialog()",
        "class": "firebugAbout fbInternational"
    }),
]);

// ********************************************************************************************* //
// Global Menu Overlays

// Firefox page context menu
$menupopupOverlay($("contentAreaContextMenu"), [
    $menuseparator(),
    $menuitem({
        id: "menu_firebugInspect",
        label: "firebug.InspectElementWithFirebug",
        command: "cmd_inspect",
        "class": "menuitem-iconic fbInternational"
    })
]);

// Firefox view menu
$menupopupOverlay($("menu_viewPopup"), [
    $menuitem({
        id: "menu_viewToggleFirebug",
        insertbefore: "toggle_taskbar",
        label: "firebug.Firebug",
        type: "checkbox",
        key: "key_toggleFirebug",
        command: "cmd_toggleFirebug",
        "class": "fbInternational"
    })
]);

// SeaMonkey view menu
$menupopupOverlay($("menu_View_Popup"), [
    $menuitem({
        id: "menu_viewToggleFirebug",
        insertafter: "menuitem_fullScreen",
        label: "firebug.Firebug",
        type: "checkbox",
        key: "key_toggleFirebug",
        command: "cmd_toggleFirebug",
        "class": "menuitem-iconic fbInternational"
    })
]);

// Firefox Tools -> Web Developer Menu
$menupopupOverlay($("menuWebDeveloperPopup"), [
    $menu({
        id: "menu_webDeveloper_firebug",
        insertbefore: "webConsole",
        label: "firebug.Firebug",
        "class": "menu-iconic fbInternational"
    }, [firebugMenuPopup.cloneNode(true)]),
    $menuseparator({
        insertbefore: "webConsole"
    })
]);

// Firefox 4 Web Developer Menu
$menupopupOverlay($("appmenu_webDeveloper_popup"), [
    $splitmenu({
        id: "appmenu_firebug",
        insertbefore: "appmenu_webConsole",
        command: "cmd_toggleFirebug",
        key: "key_toggleFirebug",
        label: "firebug.Firebug",
        iconic: "true",
        "class": "fbInternational"
    }, [firebugMenuPopup.cloneNode(true)]),
    $menuseparator({
        insertbefore: "appmenu_webConsole"
    })
]);

// Sea Monkey Tools Menu
$menupopupOverlay($("toolsPopup"), [
    $menu({
        id: "menu_firebug",
        insertbefore: "appmenu_webConsole",
        command: "cmd_toggleFirebug",
        key: "key_toggleFirebug",
        label: "firebug.Firebug",
        "class": "menuitem-iconic fbInternational"
    }, [firebugMenuPopup.cloneNode(true)])
]);

// ********************************************************************************************* //
// Firefox Toolbar Buttons

$toolbarButton("inspector-button", {
    label: "firebug.Inspect",
    tooltiptext: "firebug.InspectElement",
    observes: "cmd_toggleInspecting",
    style: "list-style-image: url(chrome://firebug/skin/inspect.png);" +
        "-moz-image-region: rect(0, 16px, 16px, 0);"
});

// TODO: why contextmenu doesn't work without cloning
$toolbarButton("firebug-button", {
    label: "firebug.Firebug",
    tooltiptext: "firebug.ShowFirebug",
    type: "menu-button",
    command: "cmd_toggleFirebug",
    contextmenu: "fbStatusContextMenu",
    observes: "firebugStatus",
    style: "list-style-image: url(chrome://firebug/skin/firebug16.png)"
}, [$("fbStatusContextMenu").cloneNode(true)]);

// Appends Firebug start button into Firefox toolbar automatically after installation.
// The button is appended only once - if the user removes it, it isn't appended again.
// TODO: merge into $toolbarButton?
// toolbarpalette check is for seamonkey, where it is in the document
if ((!$("firebug-button") || $("firebug-button").parentNode.tagName == "toolbarpalette")
    && !FirebugLoader.getPref("toolbarCustomizationDone"))
{
    FirebugLoader.setPref("toolbarCustomizationDone", true);

    // Get the current navigation bar button set (a string of button IDs) and append
    // ID of the Firebug start button into it.
    var startButtonId = "firebug-button";
    var navBarId = "nav-bar";
    var navBar = $(navBarId);
    var currentSet = navBar.currentSet;

    if (FBTrace.DBG_INITIALIZE)
        FBTrace.sysout("Startbutton; curSet (before modification): " + currentSet);

    // Append only if the button is not already there.
    var curSet = currentSet.split(",");
    if (curSet.indexOf(startButtonId) == -1)
    {
        navBar.insertItem(startButtonId);
        navBar.setAttribute("currentset", navBar.currentSet);
        navBar.ownerDocument.persist("nav-bar", "currentset");

        // Check whether insertItem really works
        var curSet = navBar.currentSet.split(",");
        if (curSet.indexOf(startButtonId) == -1)
        {
            FBTrace.sysout("Startbutton; navBar.insertItem doesn't work", curSet);
        }

        if (FBTrace.DBG_INITIALIZE)
            FBTrace.sysout("Startbutton; curSet (after modification): " + navBar.currentSet);

        try
        {
            // The current global scope is browser.xul.
            BrowserToolboxCustomizeDone(true);
        }
        catch (e)
        {
            if (FBTrace.DBG_ERRORS)
                FBTrace.sysout("startButton; appendToToolbar EXCEPTION " + e, e);
        }
    }

    // Don't forget to show the navigation bar - just in case it's hidden.
    navBar.removeAttribute("collapsed");
    document.persist(navBarId, "collapsed");
}

// ********************************************************************************************* //
// Localization

// Internationalize all elements with 'fbInternational' class. Clone before internationalizing.
var elements = cloneArray(document.getElementsByClassName("fbInternational"));
Locale.internationalizeElements(document, elements, ["label", "tooltiptext", "aria-label"]);

// ********************************************************************************************* //
// Update About Menu

var version = Firebug.GlobalUI.getVersion();
if (version)
{
    var nodes = document.querySelectorAll(".firebugAbout");
    nodes = cloneArray(nodes);
    for (var i=0; i<nodes.length; i++)
    {
        var node = nodes[i];
        var aboutLabel = node.getAttribute("label");
        node.setAttribute("label", aboutLabel + " " + version);
        node.classList.remove("firebugAbout");
    }
}

// ********************************************************************************************* //
// First Run Page

var observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
var wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

function checkFirebugVersion(currentVersion)
{
    if (!currentVersion)
        return 1;

    var version = Firebug.GlobalUI.getVersion();

    // Use Firefox comparator service.
    var versionChecker = Cc["@mozilla.org/xpcom/version-comparator;1"].
        getService(Ci.nsIVersionComparator);
    return versionChecker.compare(version, currentVersion);
}

var SessionObserver =
{
    observe: function(subjet, topic, data)
    {
        if (topic != "sessionstore-windows-restored")
            return;

        //xxxHonza: Removing observer at this moment is risky. What if the registration
        // is done too late and the even never come?
        observerService.removeObserver(SessionObserver, "sessionstore-windows-restored");

        setTimeout(function()
        {
            // Open the page in the top most window, so the user can see it immediately.
            if (wm.getMostRecentWindow("navigator:browser") != window.top)
                return;

            // Avoid opening of the page in another browser window.
            if (checkFirebugVersion(FirebugLoader.getPref("currentVersion")) > 0)
            {
                // Don't forget to update the preference, so the page is not displayed again
                FirebugLoader.setPref("currentVersion", version);

                if (FirebugLoader.getPref("showFirstRunPage"))
                    Firebug.GlobalUI.visitWebsite("firstRunPage",  version);
            }
        }, 500);
    }
}

var currentVersion = FirebugLoader.getPref("currentVersion");
if (checkFirebugVersion(currentVersion) > 0)
    observerService.addObserver(SessionObserver, "sessionstore-windows-restored", false);

// ********************************************************************************************* //
// Context Menu Workaround

if (typeof(nsContextMenu) != "undefined")
{
    // https://bugzilla.mozilla.org/show_bug.cgi?id=433168
    var setTargetOriginal = nsContextMenu.prototype.setTarget;
    nsContextMenu.prototype.setTarget = function(aNode, aRangeParent, aRangeOffset)
    {
        setTargetOriginal.apply(this, arguments);
        if (this.isTargetAFormControl(aNode))
            this.shouldDisplay = true;
    };
}

// ********************************************************************************************* //
// All Pages Activation" is on

// Load Firebug by default if activation is on for all pages (see issue 5522)
if (FirebugLoader.getPref("allPagesActivation") == "on")
{
    Firebug.GlobalUI.startFirebug(function()
    {
        FBTrace.sysout("Firebug loaded by default since allPagesActivation is on");
    });
}

// ********************************************************************************************* //

if (FBTrace.DBG_INITIALIZE)
    FBTrace.sysout("Firebug global overlay applied");

// ********************************************************************************************* //
})()

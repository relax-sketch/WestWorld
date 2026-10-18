export function createModalLifecycle(deps) {
    const {
        addModalStyles,
        bindModalEvents,
        loadSavedSettings,
        loadCategoryLightSettings,
        loadCustomCategories,
        renderCategoriesList,
        renderDefaultWorldbookEntriesUI,
    } = deps;

    function initializeModalState() {
        addModalStyles();
        loadSavedSettings();
        bindModalEvents();
        loadCategoryLightSettings();
    }

    function restoreModalData() {
        loadCustomCategories().then(() => {
            renderCategoriesList();
            renderDefaultWorldbookEntriesUI();
        });
    }

    return {
        initializeModalState,
        restoreModalData,
    };
}

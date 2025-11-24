import NoteContextAwareWidget from "./note_context_aware_widget.js";
import options from "../services/options.js";


export default class StickyHeadersWidget extends NoteContextAwareWidget {
    private $stickyContainer!: JQuery<HTMLElement>;
    private $list!: JQuery<HTMLElement>;
    private itemHeight: number = 0;
    private tree!: Fancytree.Fancytree;
    private debouncedUpdate!: () => void;
    private updateTreePadding?: () => void;

    get parentWidget() {
        return 'left-pane';
    }

    isEnabled() {
        return super.isEnabled() && options.is("showStickyHeaders");
    }

    doRender() {
        this.$widget = $('<div class="sticky-headers-anchor"></div>');

        this.$stickyContainer = $(`
            <div class="sticky-headers-container" style="display: none; position: absolute; top: 0; left: 0; right: var(--sticky-header-scrollbar-width, 17px); z-index: 100;">
                <style>
                .sticky-headers-list {
                    display: flex;
                    flex-direction: column;
                    background-color: var(--main-background-color);
                    border-bottom: 1px solid var(--main-border-color);
                }
                .sticky-header-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 6px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .sticky-header-item:hover {
                    background-color: var(--hover-item-background-color);
                }
                .sticky-header-item-main {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    overflow: hidden;
                }
                .sticky-header-item-icon {
                    flex-shrink: 0;
                }
                .sticky-header-item-title {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .sticky-header-child-count {
                    flex-shrink: 0;
                    font-size: 12px;
                    color: var(--muted-text-color);
                    margin: 4px;
                    padding-right:16px;
                }
                </style>
                <div class="sticky-headers-list"></div>
            </div>
        `);
        this.$list = this.$stickyContainer.find('.sticky-headers-list');
        this.debouncedUpdate = this.debounce(() => this.updateStickyHeaders(), 20);
    }

    initialRenderCompleteEvent() {
        this.waitForTreeInitialization();
    }

    async waitForTreeInitialization() {
        await new Promise<void>(resolve => {
            const interval = setInterval(() => {
                const $tree = $('.tree');
                if ($tree.length > 0) {
                    const treeInstance = $.ui.fancytree.getTree($tree[0]);
                    if (treeInstance && treeInstance.rootNode) {
                        this.tree = treeInstance;
                        resolve();
                        clearInterval(interval);
                    } else if (treeInstance) {
                        $tree.one('fancytreeinit', (event, data: any) => {
                            this.tree = data.tree;
                            resolve();
                        });
                        clearInterval(interval);
                    }
                }
            }, 100);
        });

        this.injectUi();
        this.measureItemHeight();
        this.attachEventListeners();

        // Only show if enabled
        if (this.isEnabled()) {
            this.updateStickyHeaders();
        }
    }

    injectUi() {
        const $targetParent = $('.tree-wrapper');
        if ($targetParent.length > 0) {
            $targetParent.css('position', 'relative');

            const scrollbarWidth = this.getScrollbarWidth();
            $targetParent[0].style.setProperty('--sticky-header-scrollbar-width', `${scrollbarWidth}px`);

            $targetParent.prepend(this.$stickyContainer);

            // Add padding to tree to prevent content from being hidden under sticky headers
            const $tree = $('.tree');
            const updateTreePadding = () => {
                if (this.isEnabled() && this.$stickyContainer.is(':visible')) {
                    const stickyHeight = this.$stickyContainer.outerHeight() || 0;
                    $tree.css('padding-top', `${stickyHeight}px`);
                } else {
                    $tree.css('padding-top', '0px');
                }
            };

            // Store the update function so we can call it when showing/hiding
            (this as any).updateTreePadding = updateTreePadding;
        }
    }

    getScrollbarWidth() {
        const outer = document.createElement('div');
        outer.style.visibility = 'hidden';
        outer.style.overflow = 'scroll';
        document.body.appendChild(outer);

        const inner = document.createElement('div');
        outer.appendChild(inner);

        const scrollbarWidth = (outer.offsetWidth - inner.offsetWidth);
        outer.parentNode?.removeChild(outer);

        return scrollbarWidth;
    }

    measureItemHeight() {
        const $dummyItem = $(`
            <div class="sticky-header-item" style="position: absolute; top: -9999px; left: -9999px;">
                <div class="sticky-header-item-main">
                    <span class="sticky-header-item-icon note-icon"></span>
                    <span class="sticky-header-item-title">Measure Height</span>
                </div>
                <span class="sticky-header-child-count">99</span>
            </div>
        `);

        $('body').append($dummyItem);
        this.itemHeight = $dummyItem.outerHeight(true) || 30;
        $dummyItem.remove();

        if (this.itemHeight === 0) {
            console.warn("StickyHeadersWidget: Could not measure item height. Defaulting to 30px.");
            this.itemHeight = 30;
        }
    }

    attachEventListeners() {
        $('.tree').on('scroll.stickyHeaderWidget', this.debouncedUpdate);
        $('.tree').on('fancytreeexpand.stickyHeaderWidget fancytreecollapse.stickyHeaderWidget', this.debouncedUpdate);
        this.$stickyContainer.on('click', '.sticky-header-item', (e) => {
            const noteId = $(e.currentTarget).data('note-id');
            if (noteId) this.navigateToNote(noteId);
        });
    }

    doDestroy() {
        $('.tree').off('.stickyHeaderWidget');
        if (this.$stickyContainer) this.$stickyContainer.remove();
        $('.tree-wrapper').css('position', '');
    }

    debounce(func: (...args: any[]) => void, delay: number) {
        let timeout: ReturnType<typeof setTimeout>;
        return (...args: any[]) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    updateStickyHeaders() {
        if (!this.isEnabled()) {
            this.$stickyContainer.hide();
            this.updateTreePadding?.();
            return;
        }

        const $scroller = $('.tree');
        if (!$scroller.length || !this.tree || this.itemHeight === 0) {
            return;
        }

        let visibleRootNode: Fancytree.FancytreeNode | null = null;
        this.tree.visit((node: Fancytree.FancytreeNode) => {
            if (node.isVisible() && node.span && node.span.offsetHeight > 0) {
                visibleRootNode = node;
                return false;
            }
            return undefined;
        });

        if (!visibleRootNode) {
            this.$stickyContainer.hide();
            return;
        }

        const rootNode: Fancytree.FancytreeNode = visibleRootNode;
        const baseLevel = rootNode.getLevel();
        const scrollerRect = $scroller[0].getBoundingClientRect();
        let finalContextNode: Fancytree.FancytreeNode | null = null;

        this.tree.visit((node: Fancytree.FancytreeNode) => {
            if (node.isVisible() && node.span && node.span.offsetHeight > 0) {
                let currentContextNode: Fancytree.FancytreeNode | null;
                if (node.isFolder() && node.isExpanded()) {
                    currentContextNode = node;
                } else {
                    currentContextNode = node.getParent();
                }

                if (!currentContextNode || currentContextNode.getLevel() < baseLevel) {
                    return;
                }

                let pathLength = 0;
                let temp: Fancytree.FancytreeNode | null = currentContextNode;
                while (temp && temp.getLevel() >= baseLevel) {
                    pathLength++;
                    temp = temp.getParent();
                }

                const predictedHeight = pathLength * this.itemHeight;
                const referenceLine = scrollerRect.top + predictedHeight;
                const nodeRect = node.span.getBoundingClientRect();

                if (nodeRect.bottom < referenceLine) {
                    finalContextNode = currentContextNode;
                } else {
                    return false;
                }
            }
            return undefined;
        });

        const headersToShow: Array<{ noteId: string, title: string, icon: string, level: number, childFolderCount: number }> = [];

        if (finalContextNode !== null) {
            let current: Fancytree.FancytreeNode = finalContextNode;
            while (current && current.isFolder() && current.getLevel() >= baseLevel) {
                const childFolderCount = Array.isArray(current.children)
                    ? current.children.filter((c: Fancytree.FancytreeNode) => c.isFolder()).length
                    : 0;

                headersToShow.push({
                    noteId: current.data.noteId,
                    title: current.title,
                    icon: current.icon,
                    level: current.getLevel(),
                    childFolderCount: childFolderCount
                });

                current = current.getParent();
            }

        }




        this.$list.empty();
        if (headersToShow.length > 0) {
            headersToShow.reverse().forEach(header => {
                const indent = (header.level - baseLevel) * 15;
                const countHtml = header.childFolderCount > 0
                    ? `<span class="sticky-header-child-count">${header.childFolderCount}</span>`
                    : '';

                const $item = $(`
                    <div class="sticky-header-item" data-note-id="${header.noteId}" style="padding-left: ${indent + 16}px;">
                        <div class="sticky-header-item-main">
                            <span class="sticky-header-item-icon ${header.icon}"></span>
                            <span class="sticky-header-item-title">${header.title}</span>
                        </div>
                        ${countHtml}
                    </div>
                `);
                this.$list.append($item);
            });
            this.$stickyContainer.show();
        } else {
            this.$stickyContainer.hide();
        }
    }



    navigateToNote(noteId: string) {
        if (!this.tree) return;

        const nodes = this.tree.getNodesByRef(noteId);
        if (!nodes || nodes.length === 0) {
            console.warn(`StickyHeaders: Could not find any node with noteId ${noteId}.`);
            return;
        }

        const node = nodes[0];
        this.tree.setFocus(true);
        node.setActive(true, { noEvents: false });

        // Scroll the node into view with proper offset for sticky headers
        if (node.span) {
            const $scroller = $('.tree');
            const scrollerRect = $scroller[0].getBoundingClientRect();
            const nodeRect = node.span.getBoundingClientRect();
            const currentScrollTop = $scroller.scrollTop() || 0;

            // Calculate the current position of the node relative to scroll container
            const nodeRelativeTop = nodeRect.top - scrollerRect.top;

            // The sticky headers padding is already applied, so we just need to scroll
            // so the node appears right after the padding/sticky area
            const stickyHeight = this.$stickyContainer.is(':visible')
                ? (this.$stickyContainer.outerHeight() || 0)
                : 0;

            // Target position: just below sticky headers with a small gap
            const targetPosition = stickyHeight + 8; // 8px gap

            // Calculate new scroll position
            const newScrollTop = currentScrollTop + nodeRelativeTop - targetPosition;

            // Smooth scroll to position
            $scroller.animate({ scrollTop: newScrollTop }, 300);
        }
    }

    entitiesReloadedEvent() {
        setTimeout(() => {
            this.updateStickyHeaders();
        }, 200);
    }
}

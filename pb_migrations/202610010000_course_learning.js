/**
 * 创建课程学习集合。所有业务集合按 owner 限制读写，媒体文件始终留在本机。
 */
migrate((app) => {
    const users = app.findCollectionByNameOrId('users');
    users.listRule = 'id = @request.auth.id';
    users.viewRule = 'id = @request.auth.id';
    users.updateRule = 'id = @request.auth.id';
    users.deleteRule = 'id = @request.auth.id';
    users.createRule = '';
    app.save(users);

    const ownerRules = {
        listRule: 'owner = @request.auth.id',
        viewRule: 'owner = @request.auth.id',
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
        updateRule: 'owner = @request.auth.id && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)',
        deleteRule: 'owner = @request.auth.id',
    };

    /** 创建包含用户归属字段的业务集合。 */
    const create = (name, fields, indexes = []) => {
        const collection = new Collection({
            type: 'base', name, ...ownerRules,
            fields: [
                { name: 'owner', type: 'relation', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
                ...fields,
            ],
            indexes,
        });
        app.save(collection);
        return collection;
    };

    const words = create('vocabulary_items', [
        { name: 'word', type: 'text', required: true },
        { name: 'meaning', type: 'text' },
    ], ['CREATE UNIQUE INDEX idx_learning_word_owner ON vocabulary_items (owner, word)']);
    create('word_contexts', [
        { name: 'word_item', type: 'relation', required: true, maxSelect: 1, collectionId: words.id, cascadeDelete: true },
        { name: 'media_key', type: 'text', required: true },
        { name: 'media_title', type: 'text', required: true },
        { name: 'subtitle_hash', type: 'text' },
        { name: 'sentence_index', type: 'number' },
        { name: 'start_seconds', type: 'number' },
        { name: 'end_seconds', type: 'number', required: true },
        { name: 'sentence', type: 'text', required: true },
    ], ['CREATE UNIQUE INDEX idx_learning_context ON word_contexts (owner, word_item, media_key, sentence_index)']);
    create('review_events', [
        { name: 'word_item', type: 'relation', required: true, maxSelect: 1, collectionId: words.id, cascadeDelete: true },
        { name: 'rating', type: 'select', required: true, values: ['forgot', 'unsure', 'remembered'], maxSelect: 1 },
        { name: 'reviewed_at', type: 'date', required: true },
    ]);
    const notebooks = create('notebooks', [
        { name: 'title', type: 'text', required: true },
    ]);
    create('notebook_sources', [
        { name: 'notebook', type: 'relation', required: true, maxSelect: 1, collectionId: notebooks.id, cascadeDelete: true },
        { name: 'media_key', type: 'text', required: true },
        { name: 'media_title', type: 'text', required: true },
        { name: 'subtitle_hash', type: 'text', required: true },
    ], ['CREATE UNIQUE INDEX idx_learning_source ON notebook_sources (owner, notebook, media_key)']);
    create('notes', [
        { name: 'notebook', type: 'relation', required: true, maxSelect: 1, collectionId: notebooks.id, cascadeDelete: true },
        { name: 'kind', type: 'select', required: true, values: ['manual', 'summary', 'question'], maxSelect: 1 },
        { name: 'content', type: 'text', required: true },
        { name: 'citations', type: 'json' },
    ]);
    create('quiz_attempts', [
        { name: 'notebook', type: 'relation', required: true, maxSelect: 1, collectionId: notebooks.id, cascadeDelete: true },
        { name: 'questions', type: 'json', required: true },
        { name: 'answers', type: 'json' },
    ]);
    create('events', [
        { name: 'verb', type: 'text', required: true },
        { name: 'object', type: 'text', required: true },
        { name: 'occurred_at', type: 'date', required: true },
    ]);
}, (app) => {
    for (const name of ['events', 'quiz_attempts', 'notes', 'notebook_sources', 'notebooks', 'review_events', 'word_contexts', 'vocabulary_items']) {
        app.delete(app.findCollectionByNameOrId(name));
    }
});

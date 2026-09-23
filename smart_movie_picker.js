/*
 * smart_movie_picker.js — «Что посмотреть?» для Lampa
 * Версия 0.2.0
 *
 * v0.1: подборки TMDB по настроению (жанры/рейтинг/длительность).
 * v0.2 добавляет:
 *   1. Кнопку «Оценить» на карточке фильма: 👍 Нравится / 👎 Не нравится / 👁 Уже смотрели / ⏭ Не сейчас
 *   2. Локальное хранение оценок и истории показов (Lampa.Storage, только на этом устройстве)
 *   3. Исключение из подборок уже просмотренного/оценённого и того, что показывали недавно
 *   4. Персональный рейтинг: вес жанров растёт от 👍 и падает от 👎, влияет на все режимы
 *   5. Новый режим ❤️ «Наш вечер» — подборка на основе персональных весов жанров
 * v0.3 добавляет:
 *   Три режима на основе TMDB "recommendations" для конкретных фильмов-ориентиров
 *   (те же память/исключение просмотренного/скоринг, только источник кандидатов другой)
 *
 * Всё так же без своего сервера и без своего TMDB API-ключа — только
 * встроенные Lampa.Api / Lampa.Storage / Lampa.Select.
 *
 * Установка: Настройки → Расширения → Добавить плагин →
 * https://ВАШ-ЛОГИН.github.io/lampa-plugins/smart_movie_picker.js
 */
(function () {
    'use strict';

    var VERSION = '0.3.0';

    if (window.smart_movie_picker_started === VERSION) return;
    window.smart_movie_picker_started = VERSION;

    function safe(fn, where) {
        return function () {
            try { return fn.apply(this, arguments); }
            catch (e) { console.error('[smart_movie_picker] ' + (where || ''), e); }
        };
    }

    // ---------------------------------------------------------------------
    // Жанры TMDB (movie)
    // ---------------------------------------------------------------------

    var MOVIE_GENRES = {
        28: 'Боевик', 12: 'Приключения', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал',
        99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 14: 'Фэнтези', 36: 'История',
        27: 'Ужасы', 10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика',
        10770: 'ТВ фильм', 53: 'Триллер', 10752: 'Военный', 37: 'Вестерн'
    };

    var thisYear = new Date().getFullYear();

    // genres — TMDB with_genres. "|" = ИЛИ любой из жанров.
    var MODES = [
        {
            title: '❤️ Наш вечер',
            personalized: true
        },
        {
            title: '🔥 Захватывающее',
            genres: '28|53|12',
            filter: { 'vote_count.gte': 200 },
            sort_by: 'popularity.desc'
        },
        {
            title: '🤯 С неожиданной концовкой',
            genres: '53|9648|80',
            filter: { 'vote_average.gte': 7, 'vote_count.gte': 300 },
            sort_by: 'vote_average.desc'
        },
        {
            title: '😂 Лёгкое и смешное',
            genres: '35',
            filter: { 'vote_count.gte': 100 },
            sort_by: 'popularity.desc'
        },
        {
            title: '❤️ Для вечера вдвоём',
            genres: '10749|35|18',
            filter: { 'vote_count.gte': 150 },
            sort_by: 'popularity.desc'
        },
        {
            title: '😈 Триллер / детектив',
            genres: '53|9648|80',
            filter: { 'vote_count.gte': 150 },
            sort_by: 'popularity.desc'
        },
        {
            title: '⏱ До 2 часов',
            filter: { 'with_runtime.lte': 120, 'vote_count.gte': 150 },
            sort_by: 'popularity.desc'
        },
        {
            title: '⭐ Высокий рейтинг',
            filter: { 'vote_average.gte': 7.5, 'vote_count.gte': 500 },
            sort_by: 'vote_average.desc'
        },
        {
            title: '🆕 Поновее',
            filter: { 'primary_release_date.gte': (thisYear - 2) + '-01-01', 'vote_count.gte': 50 },
            sort_by: 'popularity.desc'
        },
        {
            title: '🎲 Удиви меня',
            surprise: true
        },
        {
            title: '🎬 Похоже на «Невидимый гость»',
            endpoint: 'movie/411088/recommendations'
        },
        {
            title: '🏝 Похоже на «Остров проклятых»',
            endpoint: 'movie/11324/recommendations'
        },
        {
            title: '⚖️ Похоже на «Адвокат дьявола»',
            endpoint: 'movie/1813/recommendations'
        }
    ];

    var SURPRISE_GENRES = ['28', '12', '16', '35', '80', '18', '14', '27', '9648', '10749', '878', '53', '10752'];
    var SURPRISE_SORT = ['popularity.desc', 'vote_average.desc', 'revenue.desc'];

    var MIN_RATING = 6.5;
    var RESULT_COUNT = 8;
    var COOLDOWN_DAYS = 30;
    var CANDIDATE_PAGES = 2;

    // ---------------------------------------------------------------------
    // 2. Локальное хранилище (лайки/дизлайки/просмотренные/история показов/веса жанров)
    // ---------------------------------------------------------------------

    function getList(name) {
        var value = Lampa.Storage.get(name, []);
        return Array.isArray(value) ? value : [];
    }

    function addToList(name, id) {
        var list = getList(name);
        if (list.indexOf(id) === -1) {
            list.push(id);
            Lampa.Storage.set(name, list);
        }
    }

    function removeFromList(name, id) {
        var list = getList(name);
        var idx = list.indexOf(id);
        if (idx !== -1) {
            list.splice(idx, 1);
            Lampa.Storage.set(name, list);
        }
    }

    function markShown(ids) {
        var shown = Lampa.Storage.get('smp_shown_history', {});
        var now = Date.now();
        ids.forEach(function (id) { shown[id] = now; });
        Lampa.Storage.set('smp_shown_history', shown);
    }

    function isExcluded(id) {
        if (getList('smp_likes').indexOf(id) !== -1) return true;
        if (getList('smp_dislikes').indexOf(id) !== -1) return true;
        if (getList('smp_watched').indexOf(id) !== -1) return true;

        var shown = Lampa.Storage.get('smp_shown_history', {});
        var seenAt = shown[id];

        if (seenAt && (Date.now() - seenAt) < COOLDOWN_DAYS * 24 * 60 * 60 * 1000) return true;

        return false;
    }

    function adjustGenreWeights(genreIds, delta) {
        var weights = Lampa.Storage.get('smp_genre_weights', {});
        (genreIds || []).forEach(function (id) {
            weights[id] = (weights[id] || 0) + delta;
        });
        Lampa.Storage.set('smp_genre_weights', weights);
    }

    function genreIdsOf(movie) {
        if (movie.genre_ids) return movie.genre_ids;
        if (movie.genres) return movie.genres.map(function (g) { return g.id; });
        return [];
    }

    // ---------------------------------------------------------------------
    // 1. Кнопка «Оценить» на карточке фильма
    // ---------------------------------------------------------------------

    function rate(movie, type) {
        var genreIds = genreIdsOf(movie);

        if (type === 'like') {
            addToList('smp_likes', movie.id);
            removeFromList('smp_dislikes', movie.id);
            adjustGenreWeights(genreIds, 3);
        }
        else if (type === 'dislike') {
            addToList('smp_dislikes', movie.id);
            removeFromList('smp_likes', movie.id);
            adjustGenreWeights(genreIds, -3);
        }
        else if (type === 'watched') {
            addToList('smp_watched', movie.id);
        }
        else if (type === 'skip') {
            markShown([movie.id]);
        }

        Lampa.Noty.show('Учтено ✓');
    }

    function openRatingMenu(movie) {
        var items = [
            { title: '👍 Нравится', type: 'like', checkbox: true, checked: getList('smp_likes').indexOf(movie.id) !== -1 },
            { title: '👎 Не нравится', type: 'dislike', checkbox: true, checked: getList('smp_dislikes').indexOf(movie.id) !== -1 },
            { title: '👁 Уже смотрели', type: 'watched', checkbox: true, checked: getList('smp_watched').indexOf(movie.id) !== -1 },
            { title: '⏭ Не сейчас (скрыть на время)', type: 'skip' }
        ];

        Lampa.Select.show({
            title: 'Оценить фильм',
            items: items,
            onCheck: function (a) { rate(movie, a.type); },
            onSelect: function (a) {
                rate(movie, a.type);
                Lampa.Controller.toggle('content');
            },
            onBack: function () { Lampa.Controller.toggle('content'); }
        });
    }

    function addRatingButton(body, movie) {
        var row = body.find('.full-start-new__buttons');

        if (!row.length || row.find('.smp-rate-button').length) return;

        var btn = $('<div class="full-start__button selector smp-rate-button"><span>🍿 Оценить</span></div>');
        btn.on('hover:enter', safe(function () { openRatingMenu(movie); }, 'rate-menu'));
        row.append(btn);
    }

    function trackFullCard() {
        Lampa.Listener.follow('full', safe(function (event) {
            if (event.type !== 'complite') return;

            var movie = event.data && event.data.movie;
            if (!movie) return;

            addRatingButton(event.body, movie);
        }, 'full-listener'));
    }

    // ---------------------------------------------------------------------
    // 3-4. Подбор кандидатов, фильтрация уже виденного, персональный скор
    // ---------------------------------------------------------------------

    function buildDiscoverParams(mode) {
        var params = { endpoint: mode.endpoint || 'discover/movie' };

        if (mode.endpoint) {
            // Готовый TMDB-эндпоинт (например movie/{id}/recommendations) —
            // discover-фильтры (genres/filter) он не понимает, не добавляем их.
            return params;
        }

        if (mode.personalized) {
            var weights = Lampa.Storage.get('smp_genre_weights', {});
            var topGenres = Object.keys(weights)
                .map(function (id) { return { id: id, w: weights[id] }; })
                .filter(function (g) { return g.w > 0; })
                .sort(function (a, b) { return b.w - a.w; })
                .slice(0, 5)
                .map(function (g) { return g.id; });

            if (topGenres.length) {
                params.genres = topGenres.join('|');
            }
            else {
                // холодный старт — пока нет лайков/дизлайков, берём широкий набор популярных жанров
                params.genres = '28|12|35|18|53';
            }

            params.sort_by = 'popularity.desc';
        }
        else if (mode.surprise) {
            params.genres = SURPRISE_GENRES[Math.floor(Math.random() * SURPRISE_GENRES.length)];
            params.sort_by = SURPRISE_SORT[Math.floor(Math.random() * SURPRISE_SORT.length)];
        }
        else {
            if (mode.genres) params.genres = mode.genres;
            params.sort_by = mode.sort_by || 'popularity.desc';
        }

        var filter = { 'vote_average.gte': MIN_RATING };
        for (var key in (mode.filter || {})) filter[key] = mode.filter[key];
        params.filter = filter;

        return params;
    }

    function fetchDiscoverPage(params, page, cb) {
        var p = { genres: params.genres, sort_by: params.sort_by, filter: params.filter, page: page };

        Lampa.Api.sources.tmdb.get(params.endpoint, p, function (json) {
            cb((json && json.results) || []);
        }, function () { cb([]); });
    }

    function fetchCandidates(params, pages, cb) {
        var all = [];
        var remaining = pages;

        for (var i = 1; i <= pages; i++) {
            fetchDiscoverPage(params, i, function (results) {
                all = all.concat(results);
                remaining--;
                if (remaining === 0) cb(all);
            });
        }
    }

    function scoreCandidate(movie, weights) {
        var genreScore = genreIdsOf(movie).reduce(function (sum, id) { return sum + (weights[id] || 0); }, 0);
        var ratingScore = (movie.vote_average || 0) * 2;
        var popularityScore = Math.min((movie.popularity || 0) / 10, 10);

        return genreScore + ratingScore + popularityScore;
    }

    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
    }

    function runMode(mode) {
        var params = buildDiscoverParams(mode);

        Lampa.Noty.show('Подбираем...');

        fetchCandidates(params, CANDIDATE_PAGES, safe(function (candidates) {
            var unique = {};
            candidates.forEach(function (c) { unique[c.id] = c; });

            var pool = Object.keys(unique)
                .map(function (k) { return unique[k]; })
                .filter(function (c) { return !isExcluded(c.id) && (c.vote_average || 0) >= MIN_RATING; });

            if (!pool.length) {
                Lampa.Noty.show('Не нашли новых вариантов — похоже, вы уже видели почти всё подходящее 🙂');
                return;
            }

            var weights = Lampa.Storage.get('smp_genre_weights', {});
            pool.forEach(function (c) { c.smp_score = scoreCandidate(c, weights); });
            pool.sort(function (a, b) { return b.smp_score - a.smp_score; });

            var chosen = mode.surprise
                ? shuffle(pool.slice(0, Math.max(RESULT_COUNT * 3, 20))).slice(0, RESULT_COUNT)
                : pool.slice(0, RESULT_COUNT);

            markShown(chosen.map(function (c) { return c.id; }));
            showResults(mode.title, chosen);
        }, 'run-mode'));
    }

    // ---------------------------------------------------------------------
    // 5. Показ результатов и переход в обычную карточку Lampa
    // ---------------------------------------------------------------------

    function openFullCard(movie) {
        movie.source = movie.source || 'tmdb';

        Lampa.Activity.push({
            url: '',
            component: 'full',
            id: movie.id,
            method: movie.original_name ? 'tv' : 'movie',
            card: movie,
            source: movie.source
        });
    }

    function showResults(title, movies) {
        var items = movies.map(function (m) {
            var year = (m.release_date || '').slice(0, 4);
            var genreNames = genreIdsOf(m).slice(0, 2).map(function (id) { return MOVIE_GENRES[id]; }).filter(Boolean).join(', ');
            var subtitle = '⭐ ' + (m.vote_average || 0).toFixed(1) + (year ? ' · ' + year : '') + (genreNames ? ' · ' + genreNames : '');

            return {
                title: m.title || m.original_title || '',
                subtitle: subtitle,
                template: 'selectbox_icon',
                icon: m.poster_path ? '<img src="' + Lampa.Api.img(m.poster_path, 'w200') + '">' : '',
                movie: m
            };
        });

        Lampa.Select.show({
            title: title + ' (' + items.length + ')',
            items: items,
            onSelect: function (a) { openFullCard(a.movie); },
            onBack: function () { Lampa.Controller.toggle('menu'); }
        });
    }

    // ---------------------------------------------------------------------
    // Меню
    // ---------------------------------------------------------------------

    function showMenu() {
        Lampa.Select.show({
            title: 'Что посмотреть?',
            items: MODES.map(function (mode) { return { title: mode.title, mode: mode }; }),
            onBack: function () { Lampa.Controller.toggle('menu'); },
            onSelect: function (selected) { runMode(selected.mode); }
        });
    }

    function addMenuItem() {
        var icon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="2" y="5" width="20" height="14" rx="2.5" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>';

        Lampa.Menu.addButton(icon, '🍿 Что посмотреть?', safe(showMenu, 'menu'));
    }

    var start = safe(function () {
        addMenuItem();
        trackFullCard();
        console.log('[smart_movie_picker] ' + VERSION + ' запущен');
    }, 'start');

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();

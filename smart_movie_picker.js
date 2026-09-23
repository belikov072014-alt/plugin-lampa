/*
 * smart_movie_picker.js — «Что посмотреть?» для Lampa
 * Версия 0.1.0
 *
 * Пункт меню с готовыми подборками TMDB по настроению/фильтрам.
 * Работает через стандартный экран Lampa (component: 'category_full')
 * и встроенный TMDB-прокси Lampa — свой сервер и свой TMDB API-ключ не нужны.
 *
 * Установка: Настройки → Расширения → Добавить плагин →
 * https://ВАШ-ЛОГИН.github.io/lampa-plugins/smart_movie_picker.js
 */
(function () {
    'use strict';

    var VERSION = '0.1.0';

    if (window.smart_movie_picker_started) return;
    window.smart_movie_picker_started = VERSION;

    function safe(fn, where) {
        return function () {
            try { return fn.apply(this, arguments); }
            catch (e) { console.error('[smart_movie_picker] ' + (where || ''), e); }
        };
    }

    var thisYear = new Date().getFullYear();

    // genres — TMDB with_genres (movie). "|" = ИЛИ любой из жанров, "," = И все сразу.
    var MODES = [
        {
            title: '🔥 Захватывающее',
            genres: '28|53|12', // боевик | триллер | приключения
            filter: { 'vote_average.gte': 6.5, 'vote_count.gte': 200 },
            sort_by: 'popularity.desc'
        },
        {
            title: '🤯 С неожиданной концовкой',
            genres: '53|9648|80', // триллер | детектив | криминал
            filter: { 'vote_average.gte': 7, 'vote_count.gte': 300 },
            sort_by: 'vote_average.desc'
        },
        {
            title: '😂 Лёгкое и смешное',
            genres: '35', // комедия
            filter: { 'vote_average.gte': 6, 'vote_count.gte': 100 },
            sort_by: 'popularity.desc'
        },
        {
            title: '❤️ Для вечера вдвоём',
            genres: '10749|35|18', // романтика | комедия | драма
            filter: { 'vote_average.gte': 6.5, 'vote_count.gte': 150 },
            sort_by: 'popularity.desc'
        },
        {
            title: '😈 Триллер / детектив',
            genres: '53|9648|80',
            filter: { 'vote_average.gte': 6.5, 'vote_count.gte': 150 },
            sort_by: 'popularity.desc'
        },
        {
            title: '⏱ До 2 часов',
            filter: { 'with_runtime.lte': 120, 'vote_average.gte': 6.5, 'vote_count.gte': 150 },
            sort_by: 'popularity.desc'
        },
        {
            title: '⭐ Высокий рейтинг',
            filter: { 'vote_average.gte': 7.5, 'vote_count.gte': 500 },
            sort_by: 'vote_average.desc'
        },
        {
            title: '🆕 Поновее',
            filter: { 'primary_release_date.gte': (thisYear - 2) + '-01-01', 'vote_average.gte': 6, 'vote_count.gte': 50 },
            sort_by: 'popularity.desc'
        },
        {
            title: '🎲 Удиви меня',
            surprise: true
        }
    ];

    var SURPRISE_GENRES = ['28', '12', '16', '35', '80', '18', '14', '27', '9648', '10749', '878', '53', '10752'];
    var SURPRISE_SORT = ['popularity.desc', 'vote_average.desc', 'revenue.desc'];

    function buildParams(mode) {
        var params = {
            url: 'discover/movie',
            title: mode.title,
            component: 'category_full',
            source: 'tmdb',
            page: 1
        };

        if (mode.surprise) {
            params.genres = SURPRISE_GENRES[Math.floor(Math.random() * SURPRISE_GENRES.length)];
            params.sort_by = SURPRISE_SORT[Math.floor(Math.random() * SURPRISE_SORT.length)];
            params.page = Math.floor(Math.random() * 10) + 1;
            params.filter = { 'vote_average.gte': 6.5, 'vote_count.gte': 100 };
            return params;
        }

        if (mode.genres) params.genres = mode.genres;
        if (mode.sort_by) params.sort_by = mode.sort_by;
        if (mode.filter) params.filter = mode.filter;

        return params;
    }

    function openMode(mode) {
        Lampa.Activity.push(buildParams(mode));
    }

    function showMenu() {
        Lampa.Select.show({
            title: 'Что посмотреть?',
            items: MODES.map(function (mode) { return { title: mode.title, mode: mode }; }),
            onBack: function () { Lampa.Controller.toggle('menu'); },
            onSelect: function (selected) { openMode(selected.mode); }
        });
    }

    function addMenuItem() {
        var icon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="2" y="5" width="20" height="14" rx="2.5" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>';

        var item = $('<li class="menu__item selector"><div class="menu__ico">' + icon + '</div><div class="menu__text">🍿 Что посмотреть?</div></li>');
        item.on('hover:enter', safe(showMenu, 'menu'));
        $('.menu .menu__list').eq(0).append(item);
    }

    var start = safe(function () {
        addMenuItem();
        console.log('[smart_movie_picker] ' + VERSION + ' запущен');
    }, 'start');

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();

'use strict';

function chartBlock({ structuredContent }) {
    return structuredContent.block ?? structuredContent.reportSnippet.match(/^```plotly\n[\s\S]*?\n```(?=\n|$)/)[0];
}

module.exports = { chartBlock };

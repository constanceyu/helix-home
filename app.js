/*
    0 -> node path
    1 -> app path
    2 -> owner name
    3 -> repo name
    4 -> path name (default to root)
*/
const minimist = require('minimist');

let args = minimist(process.argv.slice(2), {  
    alias: {
        o: 'owner',
        r: 'repo',
        p: 'path',
    },
    default: {
        o: 'adobe',
        r: 'helix-home',
        p: '',
    },
});

const owner = args['o'];
const repo = args['r'];
const path = args['p'];

const http = require('http');
const request = require("request-promise");
const dotenv = require('dotenv');
dotenv.config();

const Octokit = require('@octokit/rest');
const octokit = new Octokit({
    auth: process.env.HELIX_SCANNER_GITHUB_AUTH_TOKEN,
    baseUrl: 'https://api.github.com',
    log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error
    },
    request: {
        agent: undefined,
        fetch: undefined,
        timeout: 0
    }
});

const pg = require('pg');
const config = {
    host: process.env.HELIX_SCANNER_POSTGRESQL_DB_HOST,
    user: process.env.HELIX_SCANNER_POSTGRESQL_DB_USER,     
    password: process.env.HELIX_SCANNER_POSTGRESQL_DB_PASSWORD,
    database: process.env.HELIX_SCANNER_POSTGRESQL_DB_NAME,
    port: 5432,
    ssl: true
};
const client = new pg.Client(config);

const hostname = '127.0.0.1';
const server_port = 3001;

const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World\n');
});

const base_url =  `http://localhost:3000/`;

const revision = require('child_process')
.execSync('git rev-parse HEAD')
.toString().trim()

let existing_table_names = {}

const createDefaultTable = (table_name) => {
    const create_table_query = `DROP TABLE IF EXISTS ${table_name};
    CREATE TABLE IF NOT EXISTS ${table_name} (
        path        text    PRIMARY KEY
    );`
    console.log(`Preparing to execute table default creation query ${create_table_query}`)
    client.query(create_table_query)
        .catch(err => console.log(err))
    existing_table_names[table_name] = ['path']
}

const updateTextColumns = (table_name, key) => {
    const update_column_query = `ALTER TABLE ${table_name}
        ADD COLUMN IF NOT EXISTS ${key} text;`
    console.log(`Preparing to execute column insertion query ${update_column_query}`)
    client.query(update_column_query)
        .catch(err => console.log(err))
    existing_table_names[table_name].push(key)
}

const execQuery = (table_name, file_path, file_entries) => {
    let current_columns = existing_table_names[table_name]
    Object.keys(file_entries).map(key => {
        if (!current_columns.includes(key))
            updateTextColumns(table_name, key)
    })
    const query_schema = current_columns.join(', ')
    let current_values = []
    for (let column of current_columns) {
        if (column === 'path') {
            current_values.push(file_path)
        } else {
            current_values.push(file_entries[column] ? JSON.stringify(file_entries[column]) : 'NULL')
        }
    }
    const value_field = current_values .join('\', \'')
    const insert_data_query = `INSERT INTO ${table_name} (${query_schema}) VALUES ('${value_field}');`;
    console.log(`Preparing to execute data insertion query ${insert_data_query}`)
    client.query(insert_data_query)
        .catch(err => {
            console.log(`Error executing database query '${insert_data_query}': `, err)
        })
}

const updateJSONBColumn = (table_name) => {
    const column_name = 'entries'
    const update_column_query = `ALTER TABLE ${table_name}
        ADD COLUMN IF NOT EXISTS ${column_name} JSONB;`
    console.log(`Preparing to execute column insertion query ${update_column_query}`)
    client.query(update_column_query)
        .catch(err => console.log(err))
    existing_table_names[table_name].push(column_name)
}

const execJSONQuery = (table_name, path, entries) => {
    if (!existing_table_names[table_name].includes('entries'))
        updateJSONBColumn(table_name)
    const stringified_entries = JSON.stringify(entries)
    const insert_data_query = `INSERT INTO ${table_name} (path, entries) VALUES ('${path}', '${stringified_entries}')
        ON CONFLICT (path) DO UPDATE SET entries = EXCLUDED.entries;`;
    console.log(`Preparing to execute data insertion query ${insert_data_query}`)
    client.query(insert_data_query)
        .catch(err => {
            console.log(`Error executing database query '${insert_data_query}': `, err)
        })
}

const traverseTree = () => octokit.git.getTree({
    owner: owner,
    repo: repo,
    tree_sha: revision,
    recursive: 1,
}).then(response => {
    if (path == '')
        return response.data.tree.filter(obj => obj.type === 'blob' && !obj.path.startsWith('.github') && obj.path.endsWith('.md'))
    else
        // error prone if the directory path has the exact string bc using 'includes'
        // e.g. if i only want hackathons/hack, this method gives me hackathons/ too
        return response.data.tree.filter(obj => obj.type === 'blob' && !obj.path.startsWith('.github') && obj.path.endsWith('.md') && obj.path.includes(path))
}).then(files => 
    files.map(file => {
        const wrapper = {}
        const idx_html = file.path.replace('.md', '.idx.html')
        wrapper[base_url.concat(idx_html)] = `/${file.path}`
        return wrapper
    })
).then(urls => urls.map((url_object) => {
    for (const [url, path] of Object.entries(url_object)) {
        request({uri: url, json: true})
        .then(content => {
            console.log('the request url is: ', url)
            console.log('the title and description of this url is: ', content.tables[0].entries)
            console.log('the entire content block looks like: ', content)

            content.tables.map(table => {
                const table_name = table.name
                console.log('existing table name',existing_table_names)
                if (!(table_name in existing_table_names)) {
                    createDefaultTable(table_name)
                }
                // execQuery(table_name, path, table.entries)
                execJSONQuery(table_name, path, table.entries)
            })
        })
    }
}))

server.listen(server_port, hostname, () => {
    console.log(`Server running at http://${hostname}:${server_port}/`);

    client.connect(err => {
        if (err) throw err;
        else {
            console.log('PostgresDB connected.')
            traverseTree()
        }
    })
});

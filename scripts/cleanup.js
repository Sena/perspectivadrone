import { execSync } from 'child_process';

const oldFields = [
    'hero_title', 'hero_subtitle', 'hero_image',
    'hero_stat1_value', 'hero_stat1_label',
    'hero_stat2_value', 'hero_stat2_label',
    'hero_stat3_value', 'hero_stat3_label',
    'about_title', 'about_content', 'about_image',
    'about_location_label', 'about_location_value', 'about_location_coords',
    'subtitle'
];

const collections = ['sections', 'posts', 'showreels'];

const isRemote = process.argv.includes('--remote');
const cmdPrefix = isRemote ? 'npx emdash' : 'npx emdash';
const extraArgs = isRemote ? '--remote' : '';

console.log(`Iniciando limpeza (${isRemote ? 'PRODUÇÃO' : 'LOCAL'})...`);

for (const col of collections) {
    try {
        console.log(`Removendo coleção: ${col}`);
        execSync(`${cmdPrefix} schema delete ${col} --force ${extraArgs}`, { stdio: 'inherit' });
    } catch (e) {
        console.log(`Coleção ${col} não encontrada ou erro ao remover.`);
    }
}

for (const field of oldFields) {
    try {
        console.log(`Removendo campo: pages/${field}`);
        execSync(`${cmdPrefix} schema remove-field pages ${field} --force ${extraArgs}`, { stdio: 'inherit' });
    } catch (e) {
        console.log(`Campo ${field} não encontrado ou erro ao remover.`);
    }
}

console.log('Limpeza concluída!');

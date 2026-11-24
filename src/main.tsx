import { AcademyStatus } from './academy';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<><AcademyStatus /><App /></>);

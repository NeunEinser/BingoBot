import { getLogger } from "log4js"
import SemVer from "./SemVer"

type IsAssignable<P, T> =
	P extends T ? true : never

type IsObjectAssignable<P> =
	P extends null ? never : P extends object ? true : never

type AddIfApplicable<A extends Array<any>, P, T, V> =
	P extends T ? Add<A, T, V> : A

type Add<A extends Array<any>, T, V> = [ ...A, V | ((v: any) => T | null) ]

type ObjectFactory<O> = (raw: Record<string, any> | undefined | null, prefix?: string) => O | null

type AddObjectIfApplicable<A extends Array<any>, O> =
	O extends null ? A :
	O extends SemVer ? [ ...A, 'SemVer' | ObjectFactory<O> ] :
	O extends Date ? [ ...A, 'Date' | ObjectFactory<O> ] :
	O extends object ? [ ...A,  ObjectFactory<O> ]
	: A

type AddObject<A extends Array<any>, O> =
	O extends null ? never :
	O extends SemVer ? [ ...A, 'SemVer' | ObjectFactory<O> ] :
	O extends Date ? [ ...A, 'Date' | ObjectFactory<O> ] :
	[ ...A,  ObjectFactory<O> ]

type AssignableKeysForTypeMap<O, T> = {
	[K in keyof O]: IsAssignable<O[K], T> extends never ? never : K
}[keyof O]

type ObjectAssignableKeysForTypeMap<O> = {
	[K in keyof O]: IsObjectAssignable<O[K]> extends never ? never : K
}[keyof O]

export type TypeMap<T> = {
	[K in AssignableKeysForTypeMap<T, string>]:
	AddIfApplicable<
		AddObjectIfApplicable<
			AddIfApplicable<
				AddIfApplicable<
					AddIfApplicable<
						AddIfApplicable<
							Add<[], string, 'string'>,
						T[K], number, 'number'>,
					T[K], bigint, 'bigint'>,
				T[K], boolean, 'boolean'>,
			T[K], symbol, 'symbol'>,
		T[K]>,
	T[K], null, 'null'>
} & {
	[K in AssignableKeysForTypeMap<T, number>]:
	AddIfApplicable<
		AddObjectIfApplicable<
			AddIfApplicable<
				AddIfApplicable<
					AddIfApplicable<
						Add<
							AddIfApplicable<[], T[K], string, 'string'>,
						number, 'number'>,
					T[K], bigint, 'bigint'>,
				T[K], boolean, 'boolean'>,
			T[K], symbol, 'symbol'>,
		T[K]>,
	T[K], null, 'null'>
} & {
	[K in AssignableKeysForTypeMap<T, bigint>]:
	AddIfApplicable<
		AddObjectIfApplicable<
			AddIfApplicable<
				AddIfApplicable<
					Add<
						AddIfApplicable<
							AddIfApplicable<[], T[K], string, 'string'>,
						T[K], number, 'number'>,
					bigint, 'bigint'>,
				T[K], boolean, 'boolean'>,
			T[K], symbol, 'symbol'>,
		T[K]>,
	T[K], null, 'null'>
} & {
	[K in AssignableKeysForTypeMap<T, boolean>]:
	AddIfApplicable<
		AddObjectIfApplicable<
			AddIfApplicable<
				Add<
					AddIfApplicable<
						AddIfApplicable<
							AddIfApplicable<[], T[K], string, 'string'>,
						T[K], number, 'number'>,
					T[K], bigint, 'bigint'>,
				boolean, 'boolean'>,
			T[K], symbol, 'symbol'>,
		T[K]>,
	T[K], null, 'null'>
} & {
	[K in AssignableKeysForTypeMap<T, symbol>]:
	AddIfApplicable<
		AddObjectIfApplicable<
			Add<
				AddIfApplicable<
					AddIfApplicable<
						AddIfApplicable<
							AddIfApplicable<[], T[K], string, 'string'>,
						T[K], number, 'number'>,
					T[K], bigint, 'bigint'>,
				T[K], boolean, 'boolean'>,
			symbol, 'symbol'>,
		T[K]>,
	T[K], null, 'null'>
} & {
	[K in ObjectAssignableKeysForTypeMap<T>]:
	AddIfApplicable<
		AddObject<
			AddIfApplicable<
				AddIfApplicable<
					AddIfApplicable<
						AddIfApplicable<
							AddIfApplicable<[], T[K], string, 'string'>,
						T[K], number, 'number'>,
					T[K], bigint, 'bigint'>,
				T[K], boolean, 'boolean'>,
			T[K], symbol, 'symbol'>,
		T[K]>,
	T[K], null, 'null'>
} & {
	[K in AssignableKeysForTypeMap<T, null>]:
	Add<
		AddObjectIfApplicable<
			AddIfApplicable<
				AddIfApplicable<
					AddIfApplicable<
						AddIfApplicable<
							AddIfApplicable<[], T[K], string, 'string'>,
						T[K], number, 'number'>,
					T[K], bigint, 'bigint'>,
				T[K], boolean, 'boolean'>,
			T[K], symbol, 'symbol'>,
		T[K]>,
	null, 'null'>
}

export type Prefix<T, V extends string> = {
	[K in keyof T as `${V}${string & K}`]: T[K]
}

export function mapTo<T>(raw: Record<string, any> | undefined | null, typeMap: TypeMap<T>, prefix: string = '') {
	const logger = getLogger('mapper');
	if (raw == undefined || raw == null)
		return null

	let result = {} as Record<keyof TypeMap<T>, any>
	let k: keyof TypeMap<T>
	for (k in typeMap) {
		const value = raw[prefix + (k as string)]
		const valueType = value === null ? 'null' : typeof value
		if ((typeMap[k] as any[]).includes(valueType)) {
			result[k] = value
		} else if (valueType === 'string' && (typeMap[k] as string[]).includes("SemVer")) {
			result[k] = SemVer.fromString(value)
		} else if (valueType == 'number' && (typeMap[k] as string[]).includes("boolean")) {
			if (value === 1) {
				result[k] = true;
			} else if (value === 0) {
				result[k] = false;
			} else {
				logger.warn(`${k as string} was not a valid numeric boolean: ${value}`);
				return null;
			}
		} else if ((typeMap[k] as any[]).includes("Date")) {
			if (valueType === 'number') {
				result[k] = new Date(value * 1_000)
			} else {
				const millis = raw[`${prefix}${(k as string)}_unix_millis`]
				if (millis === null && (typeMap[k] as string[]).includes('null')) {
					result[k] = null!
				} else if (typeof millis === 'number') {
					result[k] = new Date(millis)
				} else {
					logger.warn(`${k as string} was not a valid date. Value: ${value}; Millis: ${millis}`);
					return null;
				}
			}
		} else {
			let val = null;
			for (let f of (typeMap[k] as any[]).filter((v): v is Function => typeof v === 'function')) {
				if (f.length == 1) {
					val = f(value);
				} else if (f.length == 2) {
					val = f(raw, `${prefix}${k as string}__`);
				}
				if (val !== undefined && val !== null)  break;
			}


			if (val === undefined || val === null) {
				logger.warn(`${k as string} could not be mapped from ${value}`);
				return null;
			}
			result[k] = val
		}
	}

	return result as T
}

export function createMapper<T>(typeMap: TypeMap<T>) {
	return (raw: Record<string, any> | undefined | null, prefix?: string) => mapTo(raw, typeMap, prefix)
}

export function filterMap<R>(arr: (Record<string, any> | undefined | null)[], mapFunction: (raw: Record<string, any> | undefined | null, prefix?: string) => R | null) {
	return arr.map(v => mapFunction(v)).filter((v): v is R => v !== null)
}
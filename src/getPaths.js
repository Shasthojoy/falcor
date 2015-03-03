// TODO: Objectify?
function walk(model, root, node, pathOrJSON, depth, seedOrFunction, positionalInfo, outerResults, optimizedPath, requestedPath, inputFormat, outputFormat) {
    positionalInfo = positionalInfo || [];
    var jsonQuery = false;
    var k, i, len;
    if (inputFormat === 'JSON') {
        jsonQuery = true;
        k = Object.keys(pathOrJSON);
        if (k.length === 1) {
            k = k[0];
        }
    } else {
        k = pathOrJSON[depth];
    }
    var memo = {done: false};
    var first = true;
    var permutePosition = positionalInfo;
    var permuteRequested = requestedPath;
    var permuteOptimized = optimizedPath;
    var asPathMap = outputFormat === 'PathMap';
    var asJSONG = outputFormat === 'JSONG';
    var asJSON = outputFormat === 'JSON';
    var isKeySet = false;
    var nextPath;
    var hasChildren = false;
    depth++;

    var key;
    if (typeof k === 'object' && k) {
        memo.isArray = Array.isArray(k);
        memo.arrOffset = 0;
        
        key = permuteKey(k, memo);
        isKeySet = true;
    } else {
        key = k;
        memo.done = true;
    }
    
    if (asJSON && isKeySet) {
        permutePosition.push(depth - 1);
    }
    
    while (!memo.done || first) {
        first = false;
        if (!memo.done) {
//            permuteOptimized = [];
//            permuteRequested = [];
//            for (i = 0, len = requestedPath.length; i < len; i++) {
//                permuteRequested[i] = requestedPath[i];
//            }
//            for (i = 0, len = optimizedPath.length; i < len; i++) {
//                permuteOptimized[i] = optimizedPath[i];
//            }
//            if (asPathMap) {
//                for (i = 0, len = permutePosition.length; i < len; i++) {
//                    permutePosition[i] = permutePosition[i];
//                }
//            }

            permuteOptimized = fastCopy(optimizedPath);
            permuteRequested = fastCopy(requestedPath);
            if (asPathMap || asJSON) {
                permutePosition = fastCopy(positionalInfo);
            }
        }
        nextPath = jsonQuery ? pathOrJSON[key] : pathOrJSON;
        if (jsonQuery) {
            hasChildren = nextPath !== null && Object.keys(nextPath).length > 0;
        }

        var nodeIsSentinel = node.$type === 'sentinel';
        var next = nodeIsSentinel ? node.value[key] : node[key];

        if (next) {
            var nType = next.$type;
            var value = nType === 'sentinel' ? next.value : next;
            var valueIsArray = Array.isArray(value);

            if (key !== null) {
                permuteOptimized.push(key);
                permuteRequested.push(key);
            }
            if (asPathMap) {
                permutePosition.push(next.__generation);
            }

            if (isExpired(next)) {
                emitMissing(nextPath, depth, permuteRequested, permuteOptimized, permutePosition, outerResults, outputFormat);
            }

            else if (jsonQuery && hasChildren || !jsonQuery && depth < pathOrJSON.length) {

                if (valueIsArray) {
                    var ref = followReference(model, root, root, value);
                    var refNode = ref[0];
                    copyInto(permuteOptimized, ref[1]);

                    if (refNode) {
                        var rType = refNode.$type;
                        var rValue = rType === 'sentinel' ? refNode.value : refNode;

                        // short circuit case
                        if (rType === 'leaf') {
                            emitValues(model, refNode, nextPath, depth, seedOrFunction, outerResults, permuteRequested, permuteOptimized, permutePosition, outputFormat);
                        }

                        else if (rType === 'error') {
                            emitError(model, nextPath, depth, refNode, rValue, permuteRequested, permuteOptimized, outerResults);
                        }

                        else {
                            walk(model, root, refNode, nextPath, depth, seedOrFunction, permutePosition, outerResults, permuteOptimized, permuteRequested, inputFormat, outputFormat);
                        }
                    } else {
                        emitMissing(nextPath, depth, permuteRequested, permuteOptimized, permutePosition, outerResults, outputFormat);
                    }
                }

                else if (nType === 'error') {
                    emitError(model, nextPath, depth, next, value, permuteRequested, permuteOptimized, outerResults);
                }

                else if (nType === 'leaf') {
                    emitValues(model, next, nextPath, depth, seedOrFunction, outerResults, permuteRequested, permuteOptimized, permutePosition, outputFormat);
                }

                else {
                    walk(model, root, value, nextPath, depth, seedOrFunction, permutePosition, outerResults, permuteOptimized, permuteRequested, inputFormat, outputFormat);
                }
            }

            // we are the last depth.  This needs to be returned
            else {
                if (nType || valueIsArray) {
                    emitValues(model, next, nextPath, depth, seedOrFunction, outerResults, permuteRequested, permuteOptimized, permutePosition, outputFormat);
                } else {
                    emitMissing(nextPath, inputFormat === 'JSON' ? key : depth, permuteRequested, permuteOptimized, permutePosition, outerResults, outputFormat);
                }
            }
        } else {
            // We emit one step backwards.
            emitMissing(nextPath, depth - 1, permuteRequested, permuteOptimized, permutePosition, outerResults, outputFormat);
        }
        
        if (!memo.done) {
            key = permuteKey(k, memo);
        }
    }
}

function emitError(model, path, depth, node, nodeValue, permuteRequested, permuteOptimized, outerResults) {
    outerResults.errors.push({path: fastCopy(permuteRequested), value: copyCacheObject(nodeValue)});
    updateTrailingNullCase(path, depth, permuteRequested);
    lruPromote(model, node);
    outerResults.requestedPaths.push(permuteRequested);
    outerResults.optimizedPaths.push(permuteOptimized);
}

function emitMissing(path, depthOrMissingKey, permuteRequested, permuteOptimized, permutePosition, results, type) {
    var pathSlice;
    if (Array.isArray(path)) {
        if (depthOrMissingKey < path.length) {
            pathSlice = fastCopy(path, depthOrMissingKey);
        } else {
            pathSlice = [];
        }

        concatAndInsertMissing(pathSlice, results, permuteRequested, permuteOptimized, permutePosition, type);
    } else {
        pathSlice = [];
        spreadJSON(path, pathSlice);

        permuteRequested.push(depthOrMissingKey);
        permuteOptimized.push(depthOrMissingKey);
        
        if (pathSlice.length) {
            for (var i = 0, len = pathSlice.length; i < len; i++) {
                concatAndInsertMissing(pathSlice[i], results, permuteRequested, permuteOptimized, permutePosition, type, true);
            }
        } else {
            concatAndInsertMissing(pathSlice, results, permuteRequested, permuteOptimized, permutePosition, type);
        }
    }
    
}
function concatAndInsertMissing(remainingPath, results, permuteRequested, permuteOptimized, permutePosition, type, __null) {
    var i = 0, len;
    if (__null) {
        for (i = 0, len = remainingPath.length; i < len; i++) {
            if (remainingPath[i] === '__null') {
                remainingPath[i] = null;
            }
        }
    }
    if (type === 'JSON') {
        permuteRequested = fastCat(permuteRequested, remainingPath);
        for (i = 0, len = permutePosition.length; i < len; i++) {
            var idx = permutePosition[i];
            var r = permuteRequested[idx]
            // TODO: i think the typeof operator is no needed if there is better management of permutePosition addition
            if (typeof r !== 'object') {
                permuteRequested[idx] = [r];
            }
        }
        results.requestedMissingPaths.push(permuteRequested);
        results.optimizedMissingPaths.push(fastCatSkipNulls(permuteOptimized, remainingPath));
    } else {
        results.requestedMissingPaths.push(fastCat(permuteRequested, remainingPath));
        results.optimizedMissingPaths.push(fastCatSkipNulls(permuteOptimized, remainingPath));
    }
}
function emitValues(model, node, path, depth, seedOrFunction, outerResults, permuteRequested, permuteOptimized, permutePosition, outputFormat) {
    
    var i, len, k, key, curr;
    updateTrailingNullCase(path, depth, permuteRequested);
    lruPromote(model, node);

    outerResults.requestedPaths.push(permuteRequested);
    outerResults.optimizedPaths.push(permuteOptimized);
    switch (outputFormat) {

        case 'Values':
            var pV = cloneToPathValue(model, node, permuteRequested);
            outerResults.values.push(pV);

            if (seedOrFunction) {
                seedOrFunction(pV);
            }
            break;
        
        case 'PathMap':
            if (seedOrFunction) {
                curr = seedOrFunction;
                for (i = 0, len = permuteRequested.length - 1; i < len; i++) {
                    k = permuteRequested[i];
                    if (k === null) {
                        continue;
                    }
                    if (!curr[k]) {
                        curr[k] = {__key: k, __generation: permutePosition[i]};
                    }
                    curr = curr[k];
                }
                k = permuteRequested[i];
                if (k !== null) {
                    curr[k] = copyCacheObject(node, true);
                } else {
                    curr = copyCacheObject(node, true, curr);
                    delete curr.__key;
                    delete curr.__generation;
                }
            }
            break;
        
        case 'JSON': 
            if (seedOrFunction) {

                if (permutePosition.length) {
                    if (!seedOrFunction.json) {
                        seedOrFunction.json = {};
                    }
                    curr = seedOrFunction.json;
                    for (i = 0, len = permutePosition.length - 1; i < len; i++) {
                        k = permutePosition[i];
                        key = permuteRequested[k];
                        
                        if (!curr[key]) {
                            curr[key] = {};
                        }
                        curr = curr[key];
                    }
                    
                    // assign the last 
                    k = permutePosition[i];
                    key = permuteRequested[k];
                    curr[key] = copyCacheObject(node);
                } else {
                    seedOrFunction.json = copyCacheObject(node);
                }
            }
            break;
    }
}

function followReference(model, root, node, reference) {

    var depth = 0;
    while (true) {
        var k = reference[depth++];
        var next = node[k];

        if (next) {
            var type = next.$type;
            var value = type === 'sentinel' ? next.value : next;

            if (depth < reference.length) {
                if (type) {
                    break;
                }
                if (isExpired(next)) {
                    break;
                }

                node = next;
                continue;
            }

            else if (depth === reference.length) {

                // hit expired branch
                if (isExpired(next)) {
                    break;
                }

                // Restart the reference follower.
                if (Array.isArray(value)) {
                    depth = 0;
                    reference = value;
                    node = root;
                    continue;
                }

                node = next;
                break;
            }
        }
        break;
    }

    return [node, reference];
}
